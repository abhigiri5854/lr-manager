import { formatPaise } from "@/lib/format";
import { financialYear } from "@/lib/fy";
import { companySnapshot, partySnapshot } from "@/lib/snapshots";
import { computeFreightGst } from "@/lib/tax";
import type {
  FreightBill,
  FreightBillLine,
  FreightBillView,
  LrView,
  Page,
  Payment,
} from "@/lib/types";
import {
  freightBillFields,
  freightBillPatchSchema,
  paymentFields,
  paymentRuleErrors,
  type FreightBillInput,
  type FreightBillPatch,
  type PaymentInput,
} from "@/lib/validators/bill";
import { billForLr, receivedForBill, toLrView } from "./_derive";
import {
  allocateNumber,
  assertRef,
  assertRules,
  cancelRecord,
  clone,
  db,
  fail,
  findById,
  insertRecord,
  matchesSearch,
  newId,
  now,
  paginate,
  parseInput,
  scoped,
  updateRecord,
  type ListParams,
} from "./_store";

export type FreightBillListParams = ListParams & {
  partyId?: string;
  status?: FreightBill["status"];
};

export type PaymentListParams = ListParams & { partyId?: string };

type ParsedLine = ReturnType<typeof freightBillFields.parse>["lines"][number];

function toBillView(b: FreightBill): FreightBillView {
  const received = receivedForBill(b.companyId, b.id);
  return {
    ...clone(b),
    partyName: db.parties.find((p) => p.id === b.partyId)?.name ?? "",
    receivedPaise: received,
    duePaise: b.status === "final" && !b.cancelledAt ? b.totals.amountPaise - received : 0,
    lrNos: b.lines.map((l) => db.lrs.find((lr) => lr.id === l.lrId)?.lrNo ?? ""),
  };
}

/** LRs must be booked, live, and not on another bill. */
function assertBillableLrs(companyId: string, lines: ParsedLine[], billId?: string) {
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    const path = `lines.${i}.lrId`;
    const lr = findById(db.lrs, companyId, l.lrId);
    if (!lr || lr.cancelledAt) fail(path, "LR not found in this company");
    if (!lr.bookedAt) fail(path, `LR ${lr.lrNo} is a draft — book it before billing`);
    if (seen.has(l.lrId)) fail(path, `LR ${lr.lrNo} is ticked twice`);
    seen.add(l.lrId);
    const other = billForLr(companyId, l.lrId);
    if (other && other.id !== billId) {
      fail(path, `LR ${lr.lrNo} is already on bill ${other.billNo ?? "(draft)"}`);
    }
  });
}

/** Line totals, bill totals and GST (SGST+CGST within the state, IGST across). */
function priced(
  companyId: string,
  partyId: string,
  gstMode: FreightBill["gstMode"],
  gstRateBp: number,
  lines: ParsedLine[],
) {
  const out: FreightBillLine[] = lines.map((l) => {
    const detention = l.detentionPaise ?? 0;
    const other = l.otherPaise ?? 0;
    const advance = l.advancePaise ?? 0;
    return {
      id: l.id ?? newId(),
      lrId: l.lrId,
      freightPaise: l.freightPaise,
      detentionPaise: detention,
      otherPaise: other,
      advancePaise: advance,
      totalPaise: l.freightPaise + detention + other,
    };
  });
  const charges = out.reduce((s, l) => s + l.totalPaise, 0);
  const advance = out.reduce((s, l) => s + l.advancePaise, 0);
  const company = db.companies.find((c) => c.id === companyId)!;
  const party = db.parties.find((p) => p.id === partyId);
  const partyState = party?.stateCode ?? party?.gstin?.slice(0, 2) ?? null;
  const gst = computeFreightGst(
    charges,
    gstMode,
    gstRateBp,
    partyState === company.gstin.slice(0, 2),
  );
  return {
    lines: out,
    totals: {
      chargesPaise: charges,
      ...gst,
      advancePaise: advance,
      amountPaise: charges + gst.sgstPaise + gst.cgstPaise + gst.igstPaise - advance,
    },
  };
}

// ---------- freight bills ----------
export async function listFreightBills(
  companyId: string,
  params: FreightBillListParams = {},
): Promise<Page<FreightBillView>> {
  const rows = scoped(db.freightBills, companyId)
    .filter((b) => !params.partyId || b.partyId === params.partyId)
    .filter((b) => !params.status || b.status === params.status)
    .map(toBillView)
    .filter((b) => matchesSearch(params.search, b.billNo, b.partyName, ...b.lrNos))
    .sort((a, b) => b.billDate.localeCompare(a.billDate) || b.createdAt.localeCompare(a.createdAt));
  return paginate(rows, params);
}

export async function getFreightBillById(
  companyId: string,
  id: string,
): Promise<FreightBillView | null> {
  const b = findById(db.freightBills, companyId, id);
  return b ? toBillView(b) : null;
}

/** Booked LRs not on any bill yet (New freight bill: pick a party → its unbilled LRs). */
export async function listUnbilledLrs(companyId: string, partyId?: string): Promise<LrView[]> {
  return scoped(db.lrs, companyId)
    .filter((lr) => lr.bookedAt && !billForLr(companyId, lr.id))
    .filter((lr) => !partyId || [lr.consignorId, lr.consigneeId, lr.billedToId].includes(partyId))
    .map(toLrView);
}

/** Saves a draft bill. It gets its number only when finalised, so drafts never leave gaps. */
export async function createFreightBill(
  companyId: string,
  input: FreightBillInput,
): Promise<FreightBillView> {
  const v = parseInput(freightBillFields, input);
  assertRef(db.parties, companyId, v.partyId, "partyId", "Party");
  assertBillableLrs(companyId, v.lines);
  const gstRateBp = v.gstRateBp ?? 0;
  const t = now();
  const bill: FreightBill = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    status: "draft",
    billNo: null,
    billDate: v.billDate,
    partyId: v.partyId,
    gstMode: v.gstMode,
    gstRateBp,
    ...priced(companyId, v.partyId, v.gstMode, gstRateBp, v.lines),
    snapshot: null,
  };
  return toBillView(insertRecord("freight_bills", db.freightBills, bill));
}

export async function updateFreightBill(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: FreightBillPatch,
): Promise<FreightBillView> {
  const p = parseInput(freightBillPatchSchema, patch);
  assertRef(db.parties, companyId, p.partyId, "partyId", "Party");
  if (p.lines) assertBillableLrs(companyId, p.lines, id);
  const saved = updateRecord(
    "freight_bills",
    db.freightBills,
    companyId,
    id,
    expectedVersion,
    (current) => {
      if (current.status === "final")
        fail("", "Finalised bills can't be edited — cancel and re-issue");
      const next = { ...current, ...p, lines: current.lines };
      return {
        ...next,
        ...priced(companyId, next.partyId, next.gstMode, next.gstRateBp, p.lines ?? current.lines),
      };
    },
    "Freight bill",
  );
  return toBillView(saved);
}

/** Draft → final: allocates the bill number from the company + FY series and stores the snapshot. */
export async function finaliseFreightBill(
  companyId: string,
  id: string,
  expectedVersion: number,
): Promise<FreightBillView> {
  const saved = updateRecord(
    "freight_bills",
    db.freightBills,
    companyId,
    id,
    expectedVersion,
    (current) => {
      if (current.status === "final") fail("", "Bill is already final");
      const company = db.companies.find((c) => c.id === companyId)!;
      const party = db.parties.find((p) => p.id === current.partyId)!;
      const no = allocateNumber(companyId, "freight_bill", financialYear(current.billDate));
      return {
        ...current,
        status: "final" as const,
        billNo: `${company.freightBillPrefix}${String(no).padStart(3, "0")}`,
        snapshot: { company: companySnapshot(company), party: partySnapshot(party) },
      };
    },
    "Freight bill",
  );
  return toBillView(saved);
}

/** A cancelled final bill keeps its number (shown as cancelled) so the series has no gaps. */
export async function cancelFreightBill(companyId: string, id: string): Promise<FreightBillView> {
  if (receivedForBill(companyId, id) > 0) {
    fail("", "Payments are recorded against this bill — cancel or re-allocate them first");
  }
  return toBillView(cancelRecord("freight_bills", db.freightBills, companyId, id, "Freight bill"));
}

// ---------- payments ----------
type ParsedPayment = ReturnType<typeof paymentFields.parse>;

function checkPayment(companyId: string, v: ParsedPayment, paymentId?: string) {
  const allocations = v.allocations ?? [];
  assertRef(db.parties, companyId, v.partyId, "partyId", "Party");
  assertRules(
    paymentRuleErrors({ amountPaise: v.amountPaise, tdsPaise: v.tdsPaise ?? 0, allocations }),
  );
  allocations.forEach((a, i) => {
    const path = `allocations.${i}.amountPaise`;
    const bill = findById(db.freightBills, companyId, a.freightBillId);
    if (!bill || bill.cancelledAt || bill.status !== "final") {
      fail(`allocations.${i}.freightBillId`, "Bill not found or not final");
    }
    if (bill.partyId !== v.partyId)
      fail(`allocations.${i}.freightBillId`, `Bill ${bill.billNo} is for another party`);
    const due = bill.totals.amountPaise - receivedForBill(companyId, bill.id, paymentId);
    if (a.amountPaise > due) {
      fail(path, `More than the ₹${formatPaise(due)} due on bill ${bill.billNo}`);
    }
  });
  return allocations;
}

export async function listPayments(
  companyId: string,
  params: PaymentListParams = {},
): Promise<Page<Payment>> {
  const name = (id: string) => db.parties.find((p) => p.id === id)?.name;
  const rows = scoped(db.payments, companyId)
    .filter((p) => !params.partyId || p.partyId === params.partyId)
    .filter((p) => matchesSearch(params.search, name(p.partyId), p.reference))
    .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn))
    .map(clone);
  return paginate(rows, params);
}

export async function getPaymentById(companyId: string, id: string): Promise<Payment | null> {
  const p = findById(db.payments, companyId, id);
  return p ? clone(p) : null;
}

/** Record a payment; allocations settle bills, none = on-account advance. */
export async function createPayment(companyId: string, input: PaymentInput): Promise<Payment> {
  const v = parseInput(paymentFields, input);
  const allocations = checkPayment(companyId, v);
  const t = now();
  const payment: Payment = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    partyId: v.partyId,
    allocations,
    amountPaise: v.amountPaise,
    tdsPaise: v.tdsPaise ?? 0,
    mode: v.mode,
    receivedOn: v.receivedOn,
    reference: v.reference ?? null,
  };
  return insertRecord("payments", db.payments, payment);
}

/** Replaces the whole payment (amounts and allocations are checked together). */
export async function updatePayment(
  companyId: string,
  id: string,
  expectedVersion: number,
  input: PaymentInput,
): Promise<Payment> {
  const v = parseInput(paymentFields, input);
  const allocations = checkPayment(companyId, v, id);
  return updateRecord(
    "payments",
    db.payments,
    companyId,
    id,
    expectedVersion,
    (current) => ({
      ...current,
      partyId: v.partyId,
      allocations,
      amountPaise: v.amountPaise,
      tdsPaise: v.tdsPaise ?? 0,
      mode: v.mode,
      receivedOn: v.receivedOn,
      reference: v.reference ?? null,
    }),
    "Payment",
  );
}

export async function cancelPayment(companyId: string, id: string): Promise<Payment> {
  return cancelRecord("payments", db.payments, companyId, id, "Payment");
}

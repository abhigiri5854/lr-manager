import { billingPartyFor } from "./billing-party";
import { billPaymentStatus } from "@/lib/bill-status";
import { financialYear, todayInIndia } from "@/lib/fy";
import { cancelReasonSchema } from "@/lib/validators/invoice";
import type { BillStatus } from "@/lib/validators/bill-list";
import {
  buildBillsOverview,
  buildPartyDues,
  buildPartyLedger,
  type BillFacts,
  type BillsOverview,
  type PartyDues,
  type PartyLedger,
} from "./bill-reports";
import { companySnapshot, partySnapshot } from "@/lib/snapshots";
import type { FreightBill, FreightBillView, LrView, Page, Payment } from "@/lib/types";
import {
  freightBillFields,
  freightBillPatchSchema,
  paymentFields,
  type FreightBillInput,
  type FreightBillPatch,
  type PaymentInput,
} from "@/lib/validators/bill";
import {
  billForLr,
  receivedForBill,
  syncLrStampsForBill,
  syncLrStampsForPayment,
  toLrView,
} from "./_derive";
import {
  allocateNumber,
  assertRef,
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
  authorStamp,
} from "./_store";
import {
  applyFinalBillDate,
  assertBillableLrs,
  BILL_HAS_PAYMENTS,
  checkAllocations,
  formatBillNo,
  priceBill,
  type ParsedBillLine,
} from "./bill-calc";
import * as dbb from "./db/bills";
import { assertCan } from "./session";
import { onDatabase } from "./source";

export type FreightBillListParams = ListParams & {
  partyId?: string;
  /** Draft / Final (nothing received) / Part-paid / Paid / Cancelled. Cancelled bills only show when asked for. */
  status?: BillStatus;
  /** Bill date range, inclusive. */
  from?: string;
  to?: string;
};

export type PaymentListParams = ListParams & { partyId?: string };

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

/** Mock: what the billable-LR checks need about one LR. */
function mockLrForBill(companyId: string) {
  return (lrId: string) => {
    const lr = findById(db.lrs, companyId, lrId);
    if (!lr) return undefined;
    const other = billForLr(companyId, lrId);
    return {
      lrNo: lr.lrNo,
      live: !lr.cancelledAt,
      booked: !!lr.bookedAt,
      otherBill: other ? { id: other.id, billNo: other.billNo } : null,
    };
  };
}

function priced(
  companyId: string,
  partyId: string,
  gstMode: FreightBill["gstMode"],
  gstRateBp: number,
  lines: ParsedBillLine[],
) {
  const company = db.companies.find((c) => c.id === companyId)!;
  const party = db.parties.find((p) => p.id === partyId);
  const partyState = party?.stateCode ?? party?.gstin?.slice(0, 2) ?? null;
  return priceBill(company.gstin, partyState, gstMode, gstRateBp, lines);
}

// ---------- freight bills ----------
export async function listFreightBills(
  companyId: string,
  params: FreightBillListParams = {},
): Promise<Page<FreightBillView>> {
  if (onDatabase()) return dbb.listFreightBills(companyId, params);
  const rows = scoped(db.freightBills, companyId, params.status === "cancelled")
    .filter((b) => !params.partyId || b.partyId === params.partyId)
    .filter((b) => !params.from || b.billDate >= params.from)
    .filter((b) => !params.to || b.billDate <= params.to)
    .map(toBillView)
    .filter((b) => !params.status || billPaymentStatus(b) === params.status)
    .filter((b) => matchesSearch(params.search, b.billNo, b.partyName, ...b.lrNos))
    .sort((a, b) => b.billDate.localeCompare(a.billDate) || b.createdAt.localeCompare(a.createdAt));
  return paginate(rows, params);
}

export async function getFreightBillById(
  companyId: string,
  id: string,
): Promise<FreightBillView | null> {
  if (onDatabase()) return dbb.getFreightBillById(companyId, id);
  const b = findById(db.freightBills, companyId, id);
  return b ? toBillView(b) : null;
}

/** Booked LRs not on any bill yet (New freight bill: pick a party → its unbilled LRs). */
export async function listUnbilledLrs(companyId: string, partyId?: string): Promise<LrView[]> {
  if (onDatabase()) return dbb.listUnbilledLrs(companyId, partyId);
  return scoped(db.lrs, companyId)
    .filter((lr) => lr.bookedAt && !billForLr(companyId, lr.id))
    .filter((lr) => !partyId || billingPartyFor(lr)?.id === partyId)
    .map(toLrView);
}

/** Saves a draft bill. It gets its number only when finalised, so drafts never leave gaps. */
export async function createFreightBill(
  companyId: string,
  input: FreightBillInput,
): Promise<FreightBillView> {
  await assertCan(companyId, "bill.edit");
  const v = parseInput(freightBillFields, input);
  if (onDatabase()) return dbb.insertFreightBill(companyId, v);
  assertRef(db.parties, companyId, v.partyId, "partyId", "Party");
  assertBillableLrs(v.lines, mockLrForBill(companyId));
  const company = db.companies.find((c) => c.id === companyId);
  const gstRateBp =
    v.gstRateBp ?? (v.gstMode === "forward_charge" ? (company?.freightGstRateBp ?? 0) : 0);
  const t = now();
  const bill: FreightBill = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...authorStamp(),
    status: "draft",
    billNo: null,
    billDate: v.billDate,
    partyId: v.partyId,
    gstMode: v.gstMode,
    gstRateBp,
    ...priced(companyId, v.partyId, v.gstMode, gstRateBp, v.lines),
    snapshot: null,
  };
  const saved = insertRecord("freight_bills", db.freightBills, bill);
  syncLrStampsForBill(companyId, saved);
  return toBillView(saved);
}

export async function updateFreightBill(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: FreightBillPatch,
): Promise<FreightBillView> {
  await assertCan(companyId, "bill.edit");
  const p = parseInput(freightBillPatchSchema, patch);
  if (onDatabase()) return dbb.updateFreightBill(companyId, id, expectedVersion, p);
  assertRef(db.parties, companyId, p.partyId, "partyId", "Party");
  if (p.lines) assertBillableLrs(p.lines, mockLrForBill(companyId), id);
  const before = findById(db.freightBills, companyId, id);
  const beforeLines = before ? clone(before.lines) : [];
  const saved = updateRecord(
    "freight_bills",
    db.freightBills,
    companyId,
    id,
    expectedVersion,
    (current) => {
      if (current.status === "final") return applyFinalBillDate(current, p);
      const next = { ...current, ...p, lines: current.lines };
      return {
        ...next,
        ...priced(companyId, next.partyId, next.gstMode, next.gstRateBp, p.lines ?? current.lines),
      };
    },
    "Freight bill",
  );
  syncLrStampsForBill(companyId, { lines: beforeLines }, saved);
  return toBillView(saved);
}

/** Draft → final: allocates the bill number from the company + FY series and stores the snapshot. */
export async function finaliseFreightBill(
  companyId: string,
  id: string,
  expectedVersion: number,
): Promise<FreightBillView> {
  await assertCan(companyId, "bill.edit");
  if (onDatabase()) return dbb.finaliseFreightBill(companyId, id, expectedVersion);
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
        billNo: formatBillNo(company.freightBillPrefix, no),
        numberFy: financialYear(current.billDate),
        snapshot: { company: companySnapshot(company), party: partySnapshot(party) },
      };
    },
    "Freight bill",
  );
  syncLrStampsForBill(companyId, saved);
  return toBillView(saved);
}

/** A cancelled final bill keeps its number (shown as cancelled) so the series has no gaps. */
export async function cancelFreightBill(
  companyId: string,
  id: string,
  reason?: string,
): Promise<FreightBillView> {
  await assertCan(companyId, "record.cancel");
  const cancelReason = reason === undefined ? undefined : parseInput(cancelReasonSchema, reason);
  if (onDatabase()) return dbb.cancelFreightBill(companyId, id, cancelReason);
  if (receivedForBill(companyId, id) > 0) fail("", BILL_HAS_PAYMENTS);
  const saved = cancelRecord(
    "freight_bills",
    db.freightBills,
    companyId,
    id,
    "Freight bill",
    cancelReason === undefined ? {} : { cancelReason },
  );
  syncLrStampsForBill(companyId, saved);
  return toBillView(saved);
}

// ---------- payments ----------
type ParsedPayment = ReturnType<typeof paymentFields.parse>;

function checkPayment(companyId: string, v: ParsedPayment, paymentId?: string) {
  assertRef(db.parties, companyId, v.partyId, "partyId", "Party");
  return checkAllocations(v, (billId) => {
    const bill = findById(db.freightBills, companyId, billId);
    return bill
      ? {
          billNo: bill.billNo,
          live: !bill.cancelledAt,
          final: bill.status === "final",
          partyId: bill.partyId,
          amountPaise: bill.totals.amountPaise,
          receivedPaise: receivedForBill(companyId, bill.id, paymentId),
        }
      : undefined;
  });
}

export async function listPayments(
  companyId: string,
  params: PaymentListParams = {},
): Promise<Page<Payment>> {
  if (onDatabase()) return dbb.listPayments(companyId, params);
  const name = (id: string) => db.parties.find((p) => p.id === id)?.name;
  const rows = scoped(db.payments, companyId)
    .filter((p) => !params.partyId || p.partyId === params.partyId)
    .filter((p) => matchesSearch(params.search, name(p.partyId), p.reference))
    .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn))
    .map(clone);
  return paginate(rows, params);
}

export async function getPaymentById(companyId: string, id: string): Promise<Payment | null> {
  if (onDatabase()) return dbb.getPaymentById(companyId, id);
  const p = findById(db.payments, companyId, id);
  return p ? clone(p) : null;
}

/** Record a payment; allocations settle bills, none = on-account advance. */
export async function createPayment(companyId: string, input: PaymentInput): Promise<Payment> {
  await assertCan(companyId, "bill.edit");
  const v = parseInput(paymentFields, input);
  if (onDatabase()) return dbb.insertPayment(companyId, v);
  const allocations = checkPayment(companyId, v);
  const t = now();
  const payment: Payment = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...authorStamp(),
    partyId: v.partyId,
    allocations,
    amountPaise: v.amountPaise,
    tdsPaise: v.tdsPaise ?? 0,
    mode: v.mode,
    receivedOn: v.receivedOn,
    reference: v.reference ?? null,
  };
  const saved = insertRecord("payments", db.payments, payment);
  syncLrStampsForPayment(companyId, saved);
  return saved;
}

/** Replaces the whole payment (amounts and allocations are checked together). */
export async function updatePayment(
  companyId: string,
  id: string,
  expectedVersion: number,
  input: PaymentInput,
): Promise<Payment> {
  await assertCan(companyId, "bill.edit");
  const v = parseInput(paymentFields, input);
  if (onDatabase()) return dbb.updatePayment(companyId, id, expectedVersion, v);
  const allocations = checkPayment(companyId, v, id);
  const before = findById(db.payments, companyId, id);
  const beforeAllocations = before ? clone(before.allocations) : [];
  const saved = updateRecord(
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
  syncLrStampsForPayment(companyId, { allocations: beforeAllocations }, saved);
  return saved;
}

export async function cancelPayment(
  companyId: string,
  id: string,
  reason?: string,
): Promise<Payment> {
  await assertCan(companyId, "record.cancel");
  const cancelReason = reason === undefined ? undefined : parseInput(cancelReasonSchema, reason);
  if (onDatabase()) return dbb.cancelPayment(companyId, id, cancelReason);
  const saved = cancelRecord(
    "payments",
    db.payments,
    companyId,
    id,
    "Payment",
    cancelReason === undefined ? {} : { cancelReason },
  );
  syncLrStampsForPayment(companyId, saved);
  return saved;
}

// ---------- Bills & payments screen: KPIs, dues by party, ledger ----------
/** The plain facts the report builders (bill-reports.ts) work from, for the whole company. */
async function loadBillFacts(companyId: string, partyId?: string): Promise<BillFacts> {
  if (onDatabase()) return dbb.loadBillFacts(companyId, partyId);
  const bills = scoped(db.freightBills, companyId)
    .filter((b) => b.status === "final" && (!partyId || b.partyId === partyId))
    .map((b) => ({
      id: b.id,
      partyId: b.partyId,
      billNo: b.billNo,
      billDate: b.billDate,
      amountPaise: b.totals.amountPaise,
      receivedPaise: receivedForBill(companyId, b.id),
    }));
  const payments = scoped(db.payments, companyId)
    .filter((p) => !partyId || p.partyId === partyId)
    .map((p) => ({
      id: p.id,
      partyId: p.partyId,
      receivedOn: p.receivedOn,
      amountPaise: p.amountPaise,
      tdsPaise: p.tdsPaise,
      allocatedPaise: p.allocations.reduce((s, a) => s + a.amountPaise, 0),
      mode: p.mode,
      reference: p.reference,
    }));
  const counts = new Map<string, number>();
  for (const lr of scoped(db.lrs, companyId)) {
    if (!lr.bookedAt || lr.paymentMode !== "tbb" || billForLr(companyId, lr.id)) continue;
    const party = billingPartyFor(lr);
    if (party) counts.set(party.id, (counts.get(party.id) ?? 0) + 1);
  }
  return {
    bills,
    payments,
    unbilledTbbByParty: [...counts].map(([partyId, count]) => ({ partyId, count })),
    parties: scoped(db.parties, companyId).map((p) => ({ id: p.id, name: p.name, place: p.place })),
  };
}

export async function getBillsOverview(companyId: string): Promise<BillsOverview> {
  return buildBillsOverview(await loadBillFacts(companyId), todayInIndia());
}

/** Payments & dues by party (the table on /bills). */
export async function listPartyDues(companyId: string): Promise<PartyDues[]> {
  return buildPartyDues(await loadBillFacts(companyId));
}

/** One party's bills, receipts and TDS with a running balance. */
export async function getPartyLedger(companyId: string, partyId: string): Promise<PartyLedger> {
  return buildPartyLedger(await loadBillFacts(companyId, partyId), partyId);
}

/** Everything /bills shows besides the bill list, from one set of facts. */
export async function getBillsSummary(companyId: string) {
  const facts = await loadBillFacts(companyId);
  return {
    overview: buildBillsOverview(facts, todayInIndia()),
    dues: buildPartyDues(facts),
  };
}

export type OpenBill = {
  id: string;
  billNo: string | null;
  billDate: string;
  amountPaise: number;
  duePaise: number;
};

/**
 * A party's final, live bills with something still due, oldest first (payment allocation).
 * `exceptPaymentId`: count that payment's own allocations as still due, so editing it can
 * re-allocate them.
 */
export async function listOpenBills(
  companyId: string,
  partyId: string,
  exceptPaymentId?: string,
): Promise<OpenBill[]> {
  const [facts, own] = await Promise.all([
    loadBillFacts(companyId, partyId),
    exceptPaymentId ? getPaymentById(companyId, exceptPaymentId) : Promise.resolve(null),
  ]);
  const ownByBill = new Map((own?.allocations ?? []).map((a) => [a.freightBillId, a.amountPaise]));
  return facts.bills
    .filter((b) => b.partyId === partyId)
    .map((b) => ({
      id: b.id,
      billNo: b.billNo,
      billDate: b.billDate,
      amountPaise: b.amountPaise,
      duePaise: Math.max(0, b.amountPaise - b.receivedPaise + (ownByBill.get(b.id) ?? 0)),
    }))
    .filter((b) => b.duePaise > 0)
    .sort((a, b) => a.billDate.localeCompare(b.billDate) || (a.billNo ?? "").localeCompare(b.billNo ?? ""));
}

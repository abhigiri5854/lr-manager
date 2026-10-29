import { billingPartyFor } from "./billing-party";
import { financialYear } from "@/lib/fy";
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
  assertBillableLrs,
  BILL_FINAL,
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
  status?: FreightBill["status"];
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
      if (current.status === "final") fail("", BILL_FINAL);
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
        snapshot: { company: companySnapshot(company), party: partySnapshot(party) },
      };
    },
    "Freight bill",
  );
  syncLrStampsForBill(companyId, saved);
  return toBillView(saved);
}

/** A cancelled final bill keeps its number (shown as cancelled) so the series has no gaps. */
export async function cancelFreightBill(companyId: string, id: string): Promise<FreightBillView> {
  await assertCan(companyId, "record.cancel");
  if (onDatabase()) return dbb.cancelFreightBill(companyId, id);
  if (receivedForBill(companyId, id) > 0) fail("", BILL_HAS_PAYMENTS);
  const saved = cancelRecord("freight_bills", db.freightBills, companyId, id, "Freight bill");
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

export async function cancelPayment(companyId: string, id: string): Promise<Payment> {
  await assertCan(companyId, "record.cancel");
  if (onDatabase()) return dbb.cancelPayment(companyId, id);
  const saved = cancelRecord("payments", db.payments, companyId, id, "Payment");
  syncLrStampsForPayment(companyId, saved);
  return saved;
}

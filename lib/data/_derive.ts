// Lookups across tables that several areas need (LR status, bill dues), and the LR stamp sync.
import { deriveLrStatus, lrStampsFrom, type LrLinkedRecords } from "@/lib/lr-status";
import type { FreightBill, Lr, LrStatusInput, LrView, Payment, Pod } from "@/lib/types";
import { db, findById, scoped } from "./_store";

/** Non-cancelled bill (draft or final) that includes this LR. */
export function billForLr(companyId: string, lrId: string): FreightBill | undefined {
  return scoped(db.freightBills, companyId).find((b) => b.lines.some((l) => l.lrId === lrId));
}

/** Allocations (incl. TDS) from non-cancelled payments against a bill, optionally ignoring one payment. */
export function receivedForBill(
  companyId: string,
  billId: string,
  exceptPaymentId?: string,
): number {
  return scoped(db.payments, companyId)
    .filter((p) => p.id !== exceptPaymentId)
    .flatMap((p) => p.allocations)
    .filter((a) => a.freightBillId === billId)
    .reduce((sum, a) => sum + a.amountPaise, 0);
}

/** Date the bill was fully settled, or null. */
export function billPaidOn(companyId: string, bill: FreightBill): string | null {
  return lrStampsFrom({ pod: null, ...linkedForBill(companyId, bill) }).paidAt;
}

function linkedForBill(
  companyId: string,
  bill: FreightBill | undefined,
): Omit<LrLinkedRecords, "pod"> {
  const finalBill = bill?.status === "final" && !bill.cancelledAt ? bill : undefined;
  if (!finalBill) return { finalBill: null, allocations: [] };
  return {
    finalBill: { billDate: finalBill.billDate, amountPaise: finalBill.totals.amountPaise },
    allocations: scoped(db.payments, companyId).flatMap((p) =>
      p.allocations
        .filter((a) => a.freightBillId === finalBill.id)
        .map((a) => ({ amountPaise: a.amountPaise, receivedOn: p.receivedOn })),
    ),
  };
}

/** The records the LR's cached stamps come from (live POD, live final bill, its payments). */
export function linkedRecordsForLr(companyId: string, lrId: string): LrLinkedRecords {
  const pod = scoped(db.pods, companyId).find((p) => p.lrId === lrId);
  return {
    pod: pod ? { receivedAt: pod.receivedAt } : null,
    ...linkedForBill(companyId, billForLr(companyId, lrId)),
  };
}

/**
 * Rewrites podReceivedAt / billedAt / paidAt on these LRs from their linked records. Called by
 * the POD, bill and payment writes in the same transaction as their change. Not an LR edit:
 * no version bump and no audit row (the POD / bill / payment carries the audit).
 */
function syncLrStamps(companyId: string, lrIds: Iterable<string>): void {
  for (const lrId of new Set(lrIds)) {
    const lr = findById(db.lrs, companyId, lrId);
    if (lr) Object.assign(lr, lrStampsFrom(linkedRecordsForLr(companyId, lrId)));
  }
}

/** POD created / updated / cancelled. */
export function syncLrStampsForPod(pod: Pick<Pod, "companyId" | "lrId">): void {
  syncLrStamps(pod.companyId, [pod.lrId]);
}

/** Freight bill created / edited / finalised / cancelled: LRs it had before and after. */
export function syncLrStampsForBill(
  companyId: string,
  ...bills: Array<Pick<FreightBill, "lines"> | null | undefined>
): void {
  syncLrStamps(
    companyId,
    bills.flatMap((b) => b?.lines.map((l) => l.lrId) ?? []),
  );
}

/** Payment created / edited / cancelled: LRs on every bill it allocated to before and after. */
export function syncLrStampsForPayment(
  companyId: string,
  ...payments: Array<Pick<Payment, "allocations"> | null | undefined>
): void {
  const billIds = new Set(
    payments.flatMap((p) => p?.allocations.map((a) => a.freightBillId) ?? []),
  );
  syncLrStampsForBill(
    companyId,
    ...[...billIds].map((id) => findById(db.freightBills, companyId, id)),
  );
}

/** The seven stamps deriveLrStatus needs, straight from the LR row. */
export function statusInputOf(lr: Lr): LrStatusInput {
  return {
    cancelledAt: lr.cancelledAt,
    bookedAt: lr.bookedAt,
    dispatchedAt: lr.dispatchedAt,
    deliveredAt: lr.deliveredAt,
    podReceivedAt: lr.podReceivedAt,
    billedAt: lr.billedAt,
    paidAt: lr.paidAt,
  };
}

export function toLrView(lr: Lr): LrView {
  const party = (id: string | null) =>
    id ? (db.parties.find((p) => p.id === id)?.name ?? null) : null;
  const values = lr.lrInvoices.map((i) => i.valuePaise).filter((v): v is number => v !== null);
  const expiries = lr.lrInvoices
    .map((i) => i.ewayExpiresAt)
    .filter((v): v is string => v !== null)
    .sort();

  return {
    ...structuredClone(lr),
    status: deriveLrStatus(statusInputOf(lr)),
    consignorName: party(lr.consignorId),
    consigneeName: party(lr.consigneeId),
    billedToName: party(lr.billedToId),
    truckNumber: lr.truckId ? (db.trucks.find((t) => t.id === lr.truckId)?.number ?? null) : null,
    totalPackages: lr.items.reduce((sum, i) => sum + i.packages, 0),
    totalValuePaise: values.length ? values.reduce((a, b) => a + b, 0) : null,
    ewayExpiresAt: expiries[0] ?? null,
  };
}

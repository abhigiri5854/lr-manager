// Lookups across tables that several areas need (LR status, bill dues).
import { deriveLrStatus } from "@/lib/lr-status";
import type { FreightBill, Lr, LrView } from "@/lib/types";
import { db, scoped } from "./_store";

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
  if (bill.status !== "final" || receivedForBill(companyId, bill.id) < bill.totals.amountPaise)
    return null;
  const dates = scoped(db.payments, companyId)
    .filter((p) => p.allocations.some((a) => a.freightBillId === bill.id))
    .map((p) => p.receivedOn)
    .sort();
  return dates.at(-1) ?? null;
}

export function toLrView(lr: Lr): LrView {
  const party = (id: string | null) =>
    id ? (db.parties.find((p) => p.id === id)?.name ?? null) : null;
  const pod = scoped(db.pods, lr.companyId).find((p) => p.lrId === lr.id);
  const bill = billForLr(lr.companyId, lr.id);
  const finalBill = bill?.status === "final" ? bill : undefined;
  const values = lr.lrInvoices.map((i) => i.valuePaise).filter((v): v is number => v !== null);
  const expiries = lr.lrInvoices
    .map((i) => i.ewayExpiresAt)
    .filter((v): v is string => v !== null)
    .sort();

  return {
    ...structuredClone(lr),
    status: deriveLrStatus({
      cancelledAt: lr.cancelledAt,
      bookedAt: lr.bookedAt,
      dispatchedAt: lr.dispatchedAt,
      deliveredAt: lr.deliveredAt,
      podReceivedAt: pod?.receivedAt ?? null,
      billedAt: finalBill ? finalBill.billDate : null,
      paidAt: finalBill ? billPaidOn(lr.companyId, finalBill) : null,
    }),
    consignorName: party(lr.consignorId),
    consigneeName: party(lr.consigneeId),
    billedToName: party(lr.billedToId),
    truckNumber: lr.truckId ? (db.trucks.find((t) => t.id === lr.truckId)?.number ?? null) : null,
    totalPackages: lr.items.reduce((sum, i) => sum + i.packages, 0),
    totalValuePaise: values.length ? values.reduce((a, b) => a + b, 0) : null,
    ewayExpiresAt: expiries[0] ?? null,
  };
}

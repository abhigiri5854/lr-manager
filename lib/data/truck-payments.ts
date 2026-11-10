import { todayInIndia } from "@/lib/fy";
import { can } from "@/lib/permissions";
import type { PayableChallan, TruckPayment } from "@/lib/types";
import {
  truckPaymentApproveFields,
  truckPaymentFields,
  truckPaymentPaidFields,
  truckPaymentReverseFields,
  truckPaymentSubmitFields,
  type TruckPaymentApproveInput,
  type TruckPaymentInput,
  type TruckPaymentPaidInput,
  type TruckPaymentReverseInput,
  type TruckPaymentSubmitInput,
} from "@/lib/validators/truck-payment";
import { fail, parseInput } from "./_store";
import * as dbp from "./db/truck-payments";
import { assertCan } from "./session";

// Truck payments exist on the database only (no mock half). Making / submitting / marking paid
// needs bill.edit (same as RLS); approving above the limit and reversing need payment.approve (Owner).

export type TruckPaymentResult = dbp.TruckPaymentResult;

export const getTruckPayment = (companyId: string, id: string): Promise<TruckPayment | null> =>
  dbp.getTruckPayment(companyId, id);

export const listPayableChallans = (companyId: string, payeeId: string): Promise<PayableChallan[]> =>
  dbp.listPayableChallans(companyId, payeeId);

/** New draft with its challan allocations. Returns the saved payment and the safeguard warnings. */
export async function createTruckPayment(
  companyId: string,
  input: TruckPaymentInput,
): Promise<TruckPaymentResult> {
  const role = await assertCan(companyId, "bill.edit");
  const v = parseInput(truckPaymentFields, input);
  return dbp.insertTruckPayment(companyId, v, { canApprove: can(role, "payment.approve") });
}

/** Draft → approved (within limit / approver submits) or pending_approval. */
export async function submitTruckPayment(
  companyId: string,
  id: string,
  expectedVersion: number | null,
  input: TruckPaymentSubmitInput = {},
): Promise<TruckPaymentResult> {
  const role = await assertCan(companyId, "bill.edit");
  const v = parseInput(truckPaymentSubmitFields, input);
  return dbp.submitTruckPayment(companyId, id, expectedVersion, {
    confirmDuplicate: v.confirmDuplicate,
    podOverrideReason: v.podOverrideReason,
    canApprove: can(role, "payment.approve"),
  });
}

export async function approveTruckPayment(
  companyId: string,
  id: string,
  expectedVersion: number | null,
  input: TruckPaymentApproveInput = {},
): Promise<TruckPaymentResult> {
  await assertCan(companyId, "payment.approve");
  const v = parseInput(truckPaymentApproveFields, input);
  return dbp.approveTruckPayment(companyId, id, expectedVersion, v.podOverrideReason);
}

/** Approved → paid: paid date (default today, not in the future) and UTR / reference. */
export async function markTruckPaymentPaid(
  companyId: string,
  id: string,
  expectedVersion: number | null,
  input: TruckPaymentPaidInput = {},
): Promise<TruckPayment> {
  await assertCan(companyId, "bill.edit");
  const v = parseInput(truckPaymentPaidFields, input);
  const today = todayInIndia();
  const paidOn = v.paidOn ?? today;
  if (paidOn > today) fail("paidOn", "The paid date can't be in the future");
  return dbp.markTruckPaymentPaid(companyId, id, expectedVersion, { paidOn, refNo: v.refNo });
}

/** Approved / paid → reversed (reason required). */
export async function reverseTruckPayment(
  companyId: string,
  id: string,
  expectedVersion: number | null,
  input: TruckPaymentReverseInput,
): Promise<TruckPayment> {
  await assertCan(companyId, "payment.approve");
  const v = parseInput(truckPaymentReverseFields, input);
  return dbp.reverseTruckPayment(companyId, id, expectedVersion, v.reason);
}

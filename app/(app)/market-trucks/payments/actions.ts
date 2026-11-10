"use server";

// Server actions for the truck payments screens. Roles are checked in lib/data/truck-payments
// (bill.edit to make / submit / mark paid; payment.approve to approve above the limit and reverse).
import { revalidatePath } from "next/cache";
import { getActiveCompanyId } from "@/lib/data/session";
import {
  approveTruckPayment,
  createTruckPayment,
  listPayableChallans,
  markTruckPaymentPaid,
  reverseTruckPayment,
  submitTruckPayment,
  type TruckPaymentResult,
} from "@/lib/data/truck-payments";
import { listTruckPartyRows } from "@/lib/data/truck-parties";
import { toPayeePick, type PayeePick } from "@/lib/truck-payee-pick";
import type { PayableChallan, TruckPayment } from "@/lib/types";
import type {
  TruckPaymentInput,
  TruckPaymentPaidInput,
  TruckPaymentReverseInput,
} from "@/lib/validators/truck-payment";
import { toFailure, type ActionFailure } from "../failure";

/** Payments change what the payments register and every challan page show. */
function refreshPaymentViews() {
  revalidatePath("/market-trucks/payments");
  revalidatePath("/market-trucks/challans");
  revalidatePath("/market-trucks/challans/[id]", "page");
}

export async function searchPayeesAction(search: string): Promise<PayeePick[]> {
  const page = await listTruckPartyRows(await getActiveCompanyId(), { search, pageSize: 8 });
  return page.rows.filter((p) => !p.cancelledAt).map(toPayeePick);
}

export async function payableChallansAction(payeeId: string): Promise<PayableChallan[]> {
  return listPayableChallans(await getActiveCompanyId(), payeeId);
}

/**
 * Saves the draft and submits it in one go (approved within the limit, else awaiting approval).
 * If submitting is blocked after the draft exists, the draft is returned with the message.
 */
export async function savePaymentAction(
  input: TruckPaymentInput,
): Promise<
  | { ok: true; payment: TruckPayment; submitError: string | null }
  | ActionFailure
> {
  const companyId = await getActiveCompanyId();
  let draft: TruckPaymentResult;
  try {
    draft = await createTruckPayment(companyId, input);
    refreshPaymentViews();
  } catch (e) {
    return toFailure(e);
  }
  try {
    const sent = await submitTruckPayment(companyId, draft.payment.id, draft.payment.version, {
      confirmDuplicate: input.confirmDuplicate ?? false,
      podOverrideReason: input.podOverrideReason ?? null,
    });
    refreshPaymentViews();
    return { ok: true, payment: sent.payment, submitError: null };
  } catch (e) {
    const f = toFailure(e);
    return { ok: true, payment: draft.payment, submitError: f.message };
  }
}

export async function submitPaymentAction(
  id: string,
  version: number,
): Promise<{ ok: true; payment: TruckPayment } | ActionFailure> {
  try {
    const r = await submitTruckPayment(await getActiveCompanyId(), id, version);
    refreshPaymentViews();
    return { ok: true, payment: r.payment };
  } catch (e) {
    return toFailure(e);
  }
}

export async function approvePaymentAction(
  id: string,
  version: number,
): Promise<{ ok: true; payment: TruckPayment } | ActionFailure> {
  try {
    const r = await approveTruckPayment(await getActiveCompanyId(), id, version);
    refreshPaymentViews();
    return { ok: true, payment: r.payment };
  } catch (e) {
    return toFailure(e);
  }
}

export async function markPaymentPaidAction(
  id: string,
  version: number,
  input: TruckPaymentPaidInput,
): Promise<{ ok: true; payment: TruckPayment } | ActionFailure> {
  try {
    const payment = await markTruckPaymentPaid(await getActiveCompanyId(), id, version, input);
    refreshPaymentViews();
    return { ok: true, payment };
  } catch (e) {
    return toFailure(e);
  }
}

export async function reversePaymentAction(
  id: string,
  version: number,
  input: TruckPaymentReverseInput,
): Promise<{ ok: true; payment: TruckPayment } | ActionFailure> {
  try {
    const payment = await reverseTruckPayment(await getActiveCompanyId(), id, version, input);
    refreshPaymentViews();
    return { ok: true, payment };
  } catch (e) {
    return toFailure(e);
  }
}

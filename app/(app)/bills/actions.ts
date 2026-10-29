"use server";

// Server actions for the freight bill and payment screens. Who may do what is checked in lib/data.
import { refresh } from "next/cache";
import {
  cancelFreightBill,
  cancelPayment,
  createFreightBill,
  createPayment,
  finaliseFreightBill,
  getPaymentById,
  listOpenBills,
  updateFreightBill,
  updatePayment,
  type OpenBill,
} from "@/lib/data/bills";
import { toActionFailure, type ActionFailure } from "@/lib/data/errors";
import { getActiveCompanyId } from "@/lib/data/session";
import type { Payment } from "@/lib/types";
import type { FreightBillInput, FreightBillPatch, PaymentInput } from "@/lib/validators/bill";
import { loadBillParty, type BillPartyData } from "./load-form";

type Saved = { ok: true; id: string; version: number } | ActionFailure;

/** Save a draft bill. Without `id` it creates one; with it, updates using expectedVersion. */
export async function saveBillAction(args: {
  id?: string;
  expectedVersion?: number;
  input: FreightBillInput | FreightBillPatch;
}): Promise<Saved> {
  const companyId = await getActiveCompanyId();
  try {
    const bill = args.id
      ? await updateFreightBill(companyId, args.id, args.expectedVersion ?? -1, args.input)
      : await createFreightBill(companyId, args.input as FreightBillInput);
    refresh();
    return { ok: true, id: bill.id, version: bill.version };
  } catch (e) {
    return toActionFailure(e);
  }
}

/** Draft → final: the bill number is allocated here and its LRs become Billed. */
export async function finaliseBillAction(
  id: string,
  expectedVersion: number,
): Promise<{ ok: true; billNo: string | null; version: number } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const bill = await finaliseFreightBill(companyId, id, expectedVersion);
    refresh();
    return { ok: true, billNo: bill.billNo, version: bill.version };
  } catch (e) {
    return toActionFailure(e);
  }
}

/** Cancel with a reason; its LRs become unbilled again. Refused while payments are recorded. */
export async function cancelBillAction(
  id: string,
  reason: string,
): Promise<{ ok: true } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    await cancelFreightBill(companyId, id, reason);
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionFailure(e);
  }
}

/** Record a payment (no id) or change one — including allocating its on-account part (id). */
export async function savePaymentAction(args: {
  id?: string;
  expectedVersion?: number;
  input: PaymentInput;
}): Promise<Saved> {
  const companyId = await getActiveCompanyId();
  try {
    const payment = args.id
      ? await updatePayment(companyId, args.id, args.expectedVersion ?? -1, args.input)
      : await createPayment(companyId, args.input);
    refresh();
    return { ok: true, id: payment.id, version: payment.version };
  } catch (e) {
    return toActionFailure(e);
  }
}

export async function cancelPaymentAction(
  id: string,
  reason: string,
): Promise<{ ok: true } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    await cancelPayment(companyId, id, reason);
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionFailure(e);
  }
}

/** Ledger: open a payment to change its allocations (or cancel it). */
export async function loadPaymentAction(id: string): Promise<Payment | null> {
  return getPaymentById(await getActiveCompanyId(), id);
}

/** New bill form: the party's unbilled LRs, once a party is picked. */
export async function loadBillPartyAction(partyId: string): Promise<BillPartyData> {
  return loadBillParty(await getActiveCompanyId(), partyId);
}

/** Payment form: the party's bills with something due, oldest first. */
export async function loadOpenBillsAction(
  partyId: string,
  exceptPaymentId?: string,
): Promise<OpenBill[]> {
  return listOpenBills(await getActiveCompanyId(), partyId, exceptPaymentId);
}

"use server";

// Server actions for the tax invoice screens. Role checks come with auth (Phase 4).
import { refresh } from "next/cache";
import { toActionFailure, type ActionFailure } from "@/lib/data/errors";
import {
  cancelTaxInvoice,
  createTaxInvoice,
  finaliseTaxInvoice,
  updateTaxInvoice,
} from "@/lib/data/invoices";
import { getActiveCompanyId } from "@/lib/data/session";
import type { TaxInvoiceInput } from "@/lib/validators/invoice";

type Saved = { ok: true; id: string; version: number } | ActionFailure;

/** Save a draft. Without `id` it creates one; with it, updates using expectedVersion. */
export async function saveInvoiceAction(args: {
  id?: string;
  expectedVersion?: number;
  input: TaxInvoiceInput;
}): Promise<Saved> {
  const companyId = await getActiveCompanyId();
  try {
    const inv = args.id
      ? await updateTaxInvoice(companyId, args.id, args.expectedVersion ?? -1, args.input)
      : await createTaxInvoice(companyId, args.input);
    refresh();
    return { ok: true, id: inv.id, version: inv.version };
  } catch (e) {
    return toActionFailure(e);
  }
}

/** Draft → final; own invoices get their number here. */
export async function finaliseInvoiceAction(
  id: string,
  expectedVersion: number,
): Promise<{ ok: true; invoiceNo: string | null } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const inv = await finaliseTaxInvoice(companyId, id, expectedVersion);
    refresh();
    return { ok: true, invoiceNo: inv.invoiceNo };
  } catch (e) {
    return toActionFailure(e);
  }
}

export async function cancelInvoiceAction(
  id: string,
  reason: string,
): Promise<{ ok: true } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    await cancelTaxInvoice(companyId, id, reason);
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionFailure(e);
  }
}

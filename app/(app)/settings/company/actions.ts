"use server";

import { refresh } from "next/cache";
import { updateCompany } from "@/lib/data/companies";
import { toActionFailure, type ActionFailure } from "@/lib/data/errors";
import { getActiveCompanyId } from "@/lib/data/session";

/** Saves the tax-invoice numbering settings of the active company. */
export async function saveInvoiceSettingsAction(
  expectedVersion: number,
  input: { taxInvoicePrefix: string; invoiceRoundOff: boolean },
): Promise<{ ok: true; version: number } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const c = await updateCompany(companyId, expectedVersion, input);
    refresh();
    return { ok: true, version: c.version };
  } catch (e) {
    return toActionFailure(e);
  }
}

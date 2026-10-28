"use server";

import { refresh } from "next/cache";
import { NotFoundError, ValidationError } from "@/lib/data/errors";
import { cancelLr } from "@/lib/data/lrs";
import { getActiveCompanyId } from "@/lib/data/session";

export type CancelLrResult = { ok: true } | { ok: false; error: string };

/** "Cancel LR" from the row menu (register and dashboard). Role checks come with auth (Phase 4). */
export async function cancelLrAction(lrId: string, reason: string): Promise<CancelLrResult> {
  const companyId = await getActiveCompanyId();
  try {
    await cancelLr(companyId, lrId, { reason });
  } catch (e) {
    if (e instanceof ValidationError || e instanceof NotFoundError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }
  refresh();
  return { ok: true };
}

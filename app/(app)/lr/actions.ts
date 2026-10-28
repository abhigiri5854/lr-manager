"use server";

import { refresh } from "next/cache";
import { NotFoundError, ValidationError, ForbiddenError } from "@/lib/data/errors";
import { cancelLr } from "@/lib/data/lrs";
import { getActiveCompanyId } from "@/lib/data/session";

export type CancelLrResult = { ok: true } | { ok: false; error: string };

/** "Cancel LR" from the row menu (register and dashboard). Role checks happen in lib/data (lib/permissions.ts). */
export async function cancelLrAction(lrId: string, reason: string): Promise<CancelLrResult> {
  const companyId = await getActiveCompanyId();
  try {
    await cancelLr(companyId, lrId, { reason });
  } catch (e) {
    if (e instanceof ValidationError || e instanceof NotFoundError || e instanceof ForbiddenError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }
  refresh();
  return { ok: true };
}

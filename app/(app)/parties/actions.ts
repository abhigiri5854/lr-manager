"use server";

// Server actions for the Parties screens. Role checks happen in lib/data (lib/permissions.ts).
import { refresh } from "next/cache";
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from "@/lib/data/errors";
import { cancelParty, createParty, findPartyByGstin, updateParty } from "@/lib/data/parties";
import { getActiveCompanyId } from "@/lib/data/session";
import type { RuleError } from "@/lib/validators/common";
import type { PartyInput, PartyPatch } from "@/lib/validators/party";

export type PartyActionFailure =
  | { ok: false; kind: "validation"; issues: RuleError[]; message: string }
  | { ok: false; kind: "conflict"; message: string }
  | { ok: false; kind: "error"; message: string };

function failure(e: unknown): PartyActionFailure {
  if (e instanceof ValidationError)
    return { ok: false, kind: "validation", issues: e.issues, message: e.message };
  if (e instanceof ConflictError) return { ok: false, kind: "conflict", message: e.message };
  if (e instanceof NotFoundError || e instanceof ForbiddenError)
    return { ok: false, kind: "error", message: e.message };
  throw e;
}

export async function addPartyAction(
  input: PartyInput,
): Promise<{ ok: true; id: string } | PartyActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const party = await createParty(companyId, { ...input, source: "manual" });
    refresh();
    return { ok: true, id: party.id };
  } catch (e) {
    return failure(e);
  }
}

export async function updatePartyAction(
  id: string,
  expectedVersion: number,
  patch: PartyPatch,
): Promise<{ ok: true; version: number } | PartyActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const party = await updateParty(companyId, id, expectedVersion, patch);
    refresh();
    return { ok: true, version: party.version };
  } catch (e) {
    return failure(e);
  }
}

export async function cancelPartyAction(
  id: string,
  reason: string,
): Promise<{ ok: true } | PartyActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    await cancelParty(companyId, id, reason);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

/** Another party in this company with the same GSTIN (soft warning while typing). */
export async function gstinOwnerAction(
  gstin: string,
  exceptId?: string,
): Promise<{ id: string; name: string } | null> {
  const companyId = await getActiveCompanyId();
  const found = await findPartyByGstin(companyId, gstin);
  return found && found.id !== exceptId ? { id: found.id, name: found.name } : null;
}

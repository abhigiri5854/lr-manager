"use server";

// Server actions for the Truck parties screen. Role checks happen in lib/data (master.edit).
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/data/errors";
import { getActiveCompanyId } from "@/lib/data/session";
import {
  addTdsDeclaration,
  createTruckParty,
  listTdsDeclarations,
  updateTruckParty,
} from "@/lib/data/truck-parties";
import { uploadTruckDoc } from "@/lib/data/uploads";
import type { TdsDeclaration, TruckParty } from "@/lib/types";
import type { RuleError } from "@/lib/validators/common";
import type {
  TdsDeclarationInput,
  TruckPartyInput,
  TruckPartyPatch,
} from "@/lib/validators/truck-party";

export type TruckPartyActionFailure =
  | { ok: false; kind: "validation"; issues: RuleError[]; message: string }
  | { ok: false; kind: "conflict"; message: string }
  | { ok: false; kind: "error"; message: string };

function failure(e: unknown): TruckPartyActionFailure {
  if (e instanceof ValidationError)
    return { ok: false, kind: "validation", issues: e.issues, message: e.message };
  if (e instanceof ConflictError) return { ok: false, kind: "conflict", message: e.message };
  if (e instanceof NotFoundError || e instanceof ForbiddenError)
    return { ok: false, kind: "error", message: e.message };
  throw e;
}

export async function addTruckPartyAction(
  input: TruckPartyInput,
): Promise<{ ok: true; party: TruckParty } | TruckPartyActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    return { ok: true, party: await createTruckParty(companyId, input) };
  } catch (e) {
    return failure(e);
  }
}

export async function updateTruckPartyAction(
  id: string,
  expectedVersion: number,
  patch: TruckPartyPatch,
): Promise<{ ok: true; party: TruckParty } | TruckPartyActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    return { ok: true, party: await updateTruckParty(companyId, id, expectedVersion, patch) };
  } catch (e) {
    return failure(e);
  }
}

export async function listTdsDeclarationsAction(partyId: string): Promise<TdsDeclaration[]> {
  return listTdsDeclarations(await getActiveCompanyId(), partyId);
}

export async function addTdsDeclarationAction(
  input: TdsDeclarationInput,
): Promise<{ ok: true; declaration: TdsDeclaration } | TruckPartyActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    return { ok: true, declaration: await addTdsDeclaration(companyId, input) };
  } catch (e) {
    return failure(e);
  }
}

/** One UPI QR image or TDS declaration file (FormData: kind = "upi-qr" | "tds", file). */
export async function uploadTruckDocAction(
  form: FormData,
): Promise<{ ok: true; url: string; name: string } | { ok: false; message: string }> {
  const companyId = await getActiveCompanyId();
  const kind = form.get("kind") === "tds" ? "tds" : "upi-qr";
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, message: "Choose a file first" };
  try {
    const stored = await uploadTruckDoc(companyId, kind, {
      name: file.name,
      type: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return { ok: true, ...stored };
  } catch (e) {
    const f = failure(e);
    return { ok: false, message: f.message };
  }
}

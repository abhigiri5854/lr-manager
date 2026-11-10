import type { Page, TdsDeclaration, TruckParty } from "@/lib/types";
import {
  tdsDeclarationFields,
  truckPartyFields,
  truckPartyPatchSchema,
  truckPartyRuleErrors,
  type TdsDeclarationInput,
  type TruckPartyInput,
  type TruckPartyPatch,
} from "@/lib/validators/truck-party";
import { assertRules, parseInput, type ListParams } from "./_store";
import * as dbtp from "./db/truck-parties";
import { assertCan, getCurrentUser } from "./session";

// Truck parties exist on the database only (no mock half); the role rule is master.edit.

/** Fields only payee.bank may change: bank, UPI, verified flag and blacklist (fraud controls). */
const BANK_KEYS = [
  "bankName",
  "accountHolder",
  "accountNo",
  "ifsc",
  "upiId",
  "upiQrUrl",
  "verified",
  "status",
  "blacklistReason",
] as const;

/** On create, blank / default values are fine; anything else needs payee.bank. */
async function assertBankOnCreate(companyId: string, raw: object) {
  const r = raw as Record<string, unknown>;
  const touched = BANK_KEYS.some((k) => {
    const v = r[k];
    if (k === "status") return v !== undefined && v !== null && v !== "" && v !== "active";
    return v !== undefined && v !== null && v !== "" && v !== false;
  });
  if (touched) await assertCan(companyId, "payee.bank");
}

/** On update, naming any of these fields at all needs payee.bank (the form omits them for other roles). */
async function assertBankOnUpdate(companyId: string, raw: object) {
  const r = raw as Record<string, unknown>;
  if (BANK_KEYS.some((k) => r[k] !== undefined)) await assertCan(companyId, "payee.bank");
}

export type TruckPartyListParams = ListParams;
export type TruckPartyRow = TruckParty & { latestTdsFy: string | null };

export function listTruckPartyRows(
  companyId: string,
  params: TruckPartyListParams = {},
): Promise<Page<TruckPartyRow>> {
  return dbtp.listTruckPartyRows(companyId, params);
}

export async function createTruckParty(
  companyId: string,
  input: TruckPartyInput,
): Promise<TruckParty> {
  await assertCan(companyId, "master.edit");
  await assertBankOnCreate(companyId, input);
  const v = parseInput(truckPartyFields, input);
  if (v.status === "active") v.blacklistReason = null;
  assertRules(truckPartyRuleErrors(v));
  const user = await getCurrentUser();
  return dbtp.insertTruckParty(companyId, v, user.id);
}

export async function updateTruckParty(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: TruckPartyPatch,
): Promise<TruckParty> {
  await assertCan(companyId, "master.edit");
  await assertBankOnUpdate(companyId, patch);
  const p = parseInput(truckPartyPatchSchema, patch);
  if (p.status === "active") p.blacklistReason = null;
  return dbtp.updateTruckParty(companyId, id, expectedVersion, p);
}

export async function listTdsDeclarations(
  companyId: string,
  partyId: string,
): Promise<TdsDeclaration[]> {
  return dbtp.listTdsDeclarations(companyId, partyId);
}

export async function addTdsDeclaration(
  companyId: string,
  input: TdsDeclarationInput,
): Promise<TdsDeclaration> {
  await assertCan(companyId, "master.edit");
  const v = parseInput(tdsDeclarationFields, input);
  return dbtp.insertTdsDeclaration(companyId, v);
}

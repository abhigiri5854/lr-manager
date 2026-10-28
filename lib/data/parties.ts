import { normaliseGstin } from "@/lib/validators/common";
import type { Page, Party } from "@/lib/types";
import {
  partyFields,
  partyPatchSchema,
  partyRuleErrors,
  type PartyInput,
  type PartyPatch,
} from "@/lib/validators/party";
import {
  assertRules,
  cancelRecord,
  clone,
  db,
  fail,
  findById,
  insertRecord,
  matchesSearch,
  newId,
  now,
  paginate,
  parseInput,
  scoped,
  updateRecord,
  type ListParams,
} from "./_store";

export type PartyListParams = ListParams & { includeCancelled?: boolean };

function assertUniqueGstin(companyId: string, gstin: string | null, exceptId?: string) {
  if (!gstin) return;
  const clash = scoped(db.parties, companyId).find((p) => p.gstin === gstin && p.id !== exceptId);
  if (clash) fail("gstin", `GSTIN already saved for ${clash.name}`);
}

export async function listParties(
  companyId: string,
  params: PartyListParams = {},
): Promise<Page<Party>> {
  const rows = scoped(db.parties, companyId, params.includeCancelled)
    .filter((p) => matchesSearch(params.search, p.name, p.place, p.gstin, p.phone))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(clone);
  return paginate(rows, params);
}

export async function getPartyById(companyId: string, id: string): Promise<Party | null> {
  const p = findById(db.parties, companyId, id);
  return p ? clone(p) : null;
}

/** Used by forms and import to match a party by GST number. */
export async function findPartyByGstin(companyId: string, gstin: string): Promise<Party | null> {
  const g = normaliseGstin(gstin);
  const p = scoped(db.parties, companyId).find((x) => x.gstin === g);
  return p ? clone(p) : null;
}

export async function createParty(companyId: string, input: PartyInput): Promise<Party> {
  const v = parseInput(partyFields, input);
  const t = now();
  const party: Party = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    name: v.name,
    place: v.place ?? null,
    gstin: v.gstin ?? null,
    pan: v.pan ?? (v.gstin ? v.gstin.slice(2, 12) : null),
    phone: v.phone ?? null,
    address: v.address ?? null,
    stateCode: v.stateCode ?? (v.gstin ? v.gstin.slice(0, 2) : null),
    pincode: v.pincode ?? null,
    logoUrl: v.logoUrl ?? null,
    defaultFrom: v.defaultFrom ?? null,
    defaultPaymentMode: v.defaultPaymentMode ?? null,
    defaultGstPayer: v.defaultGstPayer ?? null,
    defaultChargedAs: v.defaultChargedAs ?? null,
    source: v.source ?? "manual",
  };
  assertRules(partyRuleErrors(party));
  assertUniqueGstin(companyId, party.gstin);
  return insertRecord("parties", db.parties, party);
}

export async function updateParty(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: PartyPatch,
): Promise<Party> {
  const p = parseInput(partyPatchSchema, patch);
  return updateRecord(
    "parties",
    db.parties,
    companyId,
    id,
    expectedVersion,
    (current) => {
      const next = { ...current, ...p };
      assertRules(partyRuleErrors(next));
      assertUniqueGstin(companyId, next.gstin, id);
      return next;
    },
    "Party",
  );
}

export async function cancelParty(companyId: string, id: string): Promise<Party> {
  return cancelRecord("parties", db.parties, companyId, id, "Party");
}

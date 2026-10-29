import { SELF_PARTY_LOCKED, selfPartyFields } from "@/lib/self-party";
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
  writeAudit,
  type ListParams,
  authorStamp,
} from "./_store";
import * as dbp from "./db/parties";
import { assertCan } from "./session";
import { onDatabase } from "./source";

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
  if (onDatabase()) return dbp.listParties(companyId, params);
  const rows = scoped(db.parties, companyId, params.includeCancelled)
    .filter((p) => matchesSearch(params.search, p.name, p.place, p.gstin, p.phone))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(clone);
  return paginate(rows, params);
}

/** Every active party as id + name + place, for filter dropdowns (not paginated). */
export async function listPartyOptions(
  companyId: string,
): Promise<{ id: string; name: string; place: string | null; isSelf: boolean }[]> {
  if (onDatabase()) return dbp.listPartyOptions(companyId);
  return scoped(db.parties, companyId)
    .map((p) => ({ id: p.id, name: p.name, place: p.place, isSelf: p.isSelf }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPartyById(companyId: string, id: string): Promise<Party | null> {
  if (onDatabase()) return dbp.getPartyById(companyId, id);
  const p = findById(db.parties, companyId, id);
  return p ? clone(p) : null;
}

/** Used by forms and import to match a party by GST number. */
export async function findPartyByGstin(companyId: string, gstin: string): Promise<Party | null> {
  if (onDatabase()) return dbp.findPartyByGstin(companyId, gstin);
  const g = normaliseGstin(gstin);
  const p = scoped(db.parties, companyId).find((x) => x.gstin === g);
  return p ? clone(p) : null;
}

export async function createParty(companyId: string, input: PartyInput): Promise<Party> {
  await assertCan(companyId, "master.edit");
  const v = parseInput(partyFields, input);
  const t = now();
  const party: Party = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...authorStamp(),
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
    isSelf: false,
  };
  assertRules(partyRuleErrors(party));
  if (onDatabase()) return dbp.insertParty(party);
  assertUniqueGstin(companyId, party.gstin);
  return insertRecord("parties", db.parties, party);
}

export async function updateParty(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: PartyPatch,
): Promise<Party> {
  await assertCan(companyId, "master.edit");
  const p = parseInput(partyPatchSchema, patch);
  if (onDatabase()) return dbp.updateParty(companyId, id, expectedVersion, p);
  return updateRecord(
    "parties",
    db.parties,
    companyId,
    id,
    expectedVersion,
    (current) => {
      if (current.isSelf) fail("", SELF_PARTY_LOCKED);
      const next = { ...current, ...p };
      assertRules(partyRuleErrors(next));
      assertUniqueGstin(companyId, next.gstin, id);
      return next;
    },
    "Party",
  );
}

/** Where a party is used: non-cancelled LRs and tax invoices, and the LR roles it plays. */
export type PartyUsage = {
  lrs: number;
  invoices: number;
  asConsignor: number;
  asConsignee: number;
  asBilledTo: number;
};

/** Why a party can't be cancelled, or null when nothing active uses it. */
export function partyBlockedReason(usage: PartyUsage): string | null {
  if (!usage.lrs && !usage.invoices) return null;
  const used = [
    usage.lrs && `${usage.lrs} LR${usage.lrs === 1 ? "" : "s"}`,
    usage.invoices && `${usage.invoices} tax invoice${usage.invoices === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" and ");
  return `Used on ${used}. Cancel those first, then this party can be cancelled.`;
}

export async function getPartyUsage(companyId: string, id: string): Promise<PartyUsage> {
  if (onDatabase()) return dbp.getPartyUsage(companyId, id);
  const lrs = scoped(db.lrs, companyId).filter((l) =>
    [l.consignorId, l.consigneeId, l.billedToId].includes(id),
  );
  const invoices = scoped(db.taxInvoices, companyId).filter((i) =>
    [i.sellerPartyId, i.billToId, i.shipToId].includes(id),
  );
  return {
    lrs: lrs.length,
    invoices: invoices.length,
    asConsignor: lrs.filter((l) => l.consignorId === id).length,
    asConsignee: lrs.filter((l) => l.consigneeId === id).length,
    asBilledTo: lrs.filter((l) => l.billedToId === id).length,
  };
}

export type PartyStats = {
  lrCount: number;
  lastLrDate: string | null;
  /** Always 0 until billing exists. */
  outstandingPaise: number;
};

/** List-page numbers for the given parties: LRs in any role, newest LR date. */
export async function getPartyStats(
  companyId: string,
  ids: string[],
): Promise<Record<string, PartyStats>> {
  if (onDatabase()) return dbp.getPartyStats(companyId, ids);
  const stats: Record<string, PartyStats> = Object.fromEntries(
    ids.map((id) => [id, { lrCount: 0, lastLrDate: null, outstandingPaise: 0 }]),
  );
  for (const lr of scoped(db.lrs, companyId)) {
    for (const id of new Set([lr.consignorId, lr.consigneeId, lr.billedToId])) {
      const s = id ? stats[id] : undefined;
      if (!s) continue;
      s.lrCount += 1;
      if (lr.lrDate && (!s.lastLrDate || lr.lrDate > s.lastLrDate)) s.lastLrDate = lr.lrDate;
    }
  }
  return stats;
}

export type ShipsTo = {
  consigneeId: string;
  name: string;
  place: string | null;
  billedToName: string | null;
  toPlace: string | null;
  fromInvoiceScan: boolean;
  /** Booked LRs / drafts sent to this consignee. */
  lrCount: number;
  draftCount: number;
};

/** Consignees this party has sent to, newest first. */
export async function listShipsTo(companyId: string, consignorId: string): Promise<ShipsTo[]> {
  if (onDatabase()) return dbp.listShipsTo(companyId, consignorId);
  const byConsignee = new Map<string, ShipsTo>();
  const lrs = scoped(db.lrs, companyId)
    .filter((l) => l.consignorId === consignorId && l.consigneeId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const lr of lrs) {
    const consignee = findById(db.parties, companyId, lr.consigneeId!);
    if (!consignee) continue;
    const row = byConsignee.get(consignee.id) ?? {
      consigneeId: consignee.id,
      name: consignee.name,
      place: consignee.place,
      billedToName:
        lr.billedToId && lr.billedToId !== consignee.id
          ? (findById(db.parties, companyId, lr.billedToId)?.name ?? null)
          : null,
      toPlace: lr.toPlace,
      fromInvoiceScan: consignee.source === "invoice_scan",
      lrCount: 0,
      draftCount: 0,
    };
    if (lr.bookedAt) row.lrCount += 1;
    else row.draftCount += 1;
    byConsignee.set(consignee.id, row);
  }
  return [...byConsignee.values()];
}

/**
 * Cancels a party that nothing active uses. A party on a live LR or tax invoice can't go,
 * because those documents (and their snapshots) point at it.
 */
export async function cancelParty(companyId: string, id: string, reason?: string): Promise<Party> {
  await assertCan(companyId, "record.cancel");
  const party = onDatabase()
    ? await dbp.getPartyById(companyId, id)
    : findById(db.parties, companyId, id);
  if (party?.isSelf) fail("", SELF_PARTY_LOCKED);
  const usage = await getPartyUsage(companyId, id);
  const blocked = partyBlockedReason(usage);
  if (blocked) fail("", blocked);
  const why = reason?.trim();
  if (onDatabase()) return dbp.cancelPartyRow(companyId, id, why || undefined);
  return cancelRecord(
    "parties",
    db.parties,
    companyId,
    id,
    "Party",
    why ? { cancelReason: why } : {},
  );
}

// ---------- the company's own "self" party ----------

/** This company as a party (consignor of goods we invoice, etc.). Created if missing. */
export async function getSelfParty(companyId: string): Promise<Party> {
  if (onDatabase()) return dbp.getSelfParty(companyId);
  return clone(syncSelfParty(companyId));
}

/**
 * Creates the self party or copies the Company profile onto it (name, GSTIN, PAN, address,
 * phone, state, PIN). Called whenever the company is saved; writes audit when something changed.
 */
export function syncSelfParty(companyId: string): Party {
  const company = db.companies.find((c) => c.id === companyId);
  if (!company) fail("", "Company not found");
  const fields = selfPartyFields(company);
  const current = db.parties.find((p) => p.companyId === companyId && p.isSelf);
  if (!current) {
    const t = now();
    const party: Party = {
      id: newId(),
      companyId,
      createdAt: t,
      updatedAt: t,
      version: 1,
      ...authorStamp(),
      ...fields,
      logoUrl: null,
      defaultFrom: null,
      defaultPaymentMode: null,
      defaultGstPayer: null,
      defaultChargedAs: null,
      source: "manual",
      isSelf: true,
    };
    insertRecord("parties", db.parties, party);
    return party;
  }
  const changed = (Object.keys(fields) as (keyof typeof fields)[]).some(
    (k) => current[k] !== fields[k],
  );
  if (!changed) return current;
  const next: Party = {
    ...current,
    ...fields,
    updatedAt: now(),
    version: current.version + 1,
  };
  db.parties[db.parties.indexOf(current)] = next;
  writeAudit(companyId, "parties", current.id, "update", current, next);
  return next;
}

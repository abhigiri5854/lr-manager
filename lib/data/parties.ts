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

/** Every active party as id + name + place, for filter dropdowns (not paginated). */
export async function listPartyOptions(
  companyId: string,
): Promise<{ id: string; name: string; place: string | null }[]> {
  return scoped(db.parties, companyId)
    .map((p) => ({ id: p.id, name: p.name, place: p.place }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
  const usage = await getPartyUsage(companyId, id);
  const blocked = partyBlockedReason(usage);
  if (blocked) fail("", blocked);
  const why = reason?.trim();
  return cancelRecord(
    "parties",
    db.parties,
    companyId,
    id,
    "Party",
    why ? { cancelReason: why } : {},
  );
}

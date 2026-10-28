"use server";

// Server actions for the New / Edit LR form. Role checks come with auth (Phase 4).
import { refresh } from "next/cache";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/data/errors";
import {
  createLr,
  findLrsWithInvoice,
  getConsigneeToPlace,
  getConsignorDefaults,
  updateLr,
  type ConsignorDefaults,
  type LrRef,
} from "@/lib/data/lrs";
import { createParty, listParties } from "@/lib/data/parties";
import { getActiveCompanyId } from "@/lib/data/session";
import { createTruck, listTruckSuggestions } from "@/lib/data/trucks";
import type { PartyOption, TruckOption } from "@/lib/lr-form";
import type { LrStatus, Party } from "@/lib/types";
import type { RuleError } from "@/lib/validators/common";
import type { LrInput } from "@/lib/validators/lr";
import type { PartyInput } from "@/lib/validators/party";
import type { TruckInput } from "@/lib/validators/truck";

export type ActionFailure =
  | { ok: false; kind: "validation"; issues: RuleError[]; message: string }
  | { ok: false; kind: "conflict"; message: string }
  | { ok: false; kind: "error"; message: string };

function failure(e: unknown): ActionFailure {
  if (e instanceof ValidationError)
    return { ok: false, kind: "validation", issues: e.issues, message: e.message };
  if (e instanceof ConflictError) return { ok: false, kind: "conflict", message: e.message };
  if (e instanceof NotFoundError) return { ok: false, kind: "error", message: e.message };
  throw e;
}

const toPartyOption = (p: Party): PartyOption => ({
  id: p.id,
  name: p.name,
  place: p.place,
  gstin: p.gstin,
  phone: p.phone,
  address: p.address,
  stateCode: p.stateCode,
  isSelf: p.isSelf,
});

/** Party autocomplete: name, place, GSTIN or phone. */
export async function searchPartiesAction(q: string): Promise<PartyOption[]> {
  const companyId = await getActiveCompanyId();
  const { rows } = await listParties(companyId, { search: q, pageSize: 8 });
  return rows.map(toPartyOption);
}

/** Truck autocomplete by number ("br 01 gn" finds BR01GN8331). */
export async function searchTrucksAction(q: string): Promise<TruckOption[]> {
  const companyId = await getActiveCompanyId();
  const rows = await listTruckSuggestions(companyId, q);
  return rows.map((t) => ({
    id: t.id,
    number: t.number,
    driverMobile: t.driverMobile,
    lastLrNo: t.lastLrNo,
  }));
}

export async function consignorDefaultsAction(
  consignorId: string,
): Promise<ConsignorDefaults | null> {
  const companyId = await getActiveCompanyId();
  return getConsignorDefaults(companyId, consignorId);
}

/** "To" to fill when a consignee is picked. */
export async function consigneeToPlaceAction(consigneeId: string): Promise<string | null> {
  const companyId = await getActiveCompanyId();
  return getConsigneeToPlace(companyId, consigneeId);
}

/** Other LRs that already carry this invoice number (duplicate warning while typing). */
export async function invoiceDuplicatesAction(
  invoiceNo: string,
  exceptLrId?: string,
): Promise<LrRef[]> {
  const companyId = await getActiveCompanyId();
  return findLrsWithInvoice(companyId, { invoiceNo }, exceptLrId);
}

export async function createPartyAction(
  input: PartyInput,
): Promise<{ ok: true; party: PartyOption } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const party = await createParty(companyId, { ...input, source: "lr" });
    return { ok: true, party: toPartyOption(party) };
  } catch (e) {
    return failure(e);
  }
}

export async function createTruckAction(
  input: TruckInput,
): Promise<{ ok: true; truck: TruckOption } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const t = await createTruck(companyId, { ...input, source: "lr" });
    return {
      ok: true,
      truck: { id: t.id, number: t.number, driverMobile: t.driverMobile, lastLrNo: null },
    };
  } catch (e) {
    return failure(e);
  }
}

export type SaveLrResult =
  { ok: true; id: string; version: number; lrNo: string; status: LrStatus } | ActionFailure;

/** Save draft / Save & book. Without `id` it creates the LR; with it, updates using expectedVersion. */
export async function saveLrAction(args: {
  id?: string;
  expectedVersion?: number;
  input: LrInput;
  book: boolean;
}): Promise<SaveLrResult> {
  const companyId = await getActiveCompanyId();
  try {
    const lr = args.id
      ? await updateLr(companyId, args.id, args.expectedVersion ?? -1, args.input, {
          book: args.book,
        })
      : await createLr(companyId, args.input, { book: args.book });
    refresh();
    return { ok: true, id: lr.id, version: lr.version, lrNo: lr.lrNo, status: lr.status };
  } catch (e) {
    return failure(e);
  }
}

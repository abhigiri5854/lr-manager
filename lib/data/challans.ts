import type { ChallanInsightQuery, ChallanInsights } from "@/lib/challan-insights";
import type { ChallanLrLine, ChallanLrPick, ChallanView } from "@/lib/types";
import {
  challanLrEwbFields,
  ewbRuleErrors,
  type ChallanLrEwbInput,
} from "@/lib/validators/challan-ewb";
import {
  challanFields,
  challanRuleErrors,
  type ChallanInput,
} from "@/lib/validators/challan";
import type { ChallanListFilters } from "@/lib/validators/challan-list";
import {
  challanVehicleChangeFields,
  type ChallanVehicleChangeInput,
} from "@/lib/validators/challan-vehicle";
import { parseInput } from "./_store";
import * as dbc from "./db/challans";
import { ValidationError } from "./errors";
import { dispatchLrOnChallan } from "./lrs";
import { assertCan } from "./session";

// Challans exist on the database only (no mock half). Writing needs lr.edit (RLS also allows bill.edit).

export const getChallan = (companyId: string, id: string): Promise<ChallanView | null> =>
  dbc.getChallan(companyId, id);

export const getChallanLrPicks = (
  companyId: string,
  challanId: string,
  lrIds: string[],
): Promise<ChallanLrPick[]> => dbc.getChallanLrPicks(companyId, challanId, lrIds);

export function searchChallanLrs(
  companyId: string,
  search: string,
  exceptChallanId: string | null,
): Promise<ChallanLrPick[]> {
  return dbc.searchLrPicks(companyId, search, exceptChallanId);
}

export const searchBrokers = (companyId: string, search: string) =>
  dbc.searchBrokers(companyId, search);

/** Create (id null) or edit a draft challan; `action: "dispatch"` also dispatches it. */
export async function saveChallan(
  companyId: string,
  id: string | null,
  expectedVersion: number | null,
  input: ChallanInput,
): Promise<ChallanView> {
  await assertCan(companyId, "lr.edit");
  const values = parseInput(challanFields, input);
  const issues = challanRuleErrors(values);
  if (issues.length) throw new ValidationError(issues);
  const saved = await dbc.saveChallan(companyId, id, expectedVersion, values);
  if (saved.status === "dispatched") {
    // Stamps each LR In transit and keeps the challan id; no own-fleet truck needed. The challan is
    // already committed, so an LR that can't be stamped (e.g. not booked) doesn't undo it.
    await Promise.allSettled(saved.lrs.map((l) => dispatchLrOnChallan(companyId, l.lrId, saved.id)));
  }
  return saved;
}

/**
 * Another vehicle (and optionally driver) on a dispatched / POD-received challan; creates one
 * "Update Part-B" task per LR with an e-way no. Needs master.edit.
 */
export async function changeChallanVehicle(
  companyId: string,
  id: string,
  expectedVersion: number,
  input: ChallanVehicleChangeInput,
): Promise<dbc.VehicleChangeResult> {
  await assertCan(companyId, "master.edit");
  const values = parseInput(challanVehicleChangeFields, input);
  return dbc.changeChallanVehicle(companyId, id, expectedVersion, values);
}

/** E-way bill details of one LR line (draft or on the road, not settled). Needs master.edit. */
export async function updateChallanLrEwb(
  companyId: string,
  id: string,
  expectedVersion: number,
  input: ChallanLrEwbInput,
): Promise<ChallanLrLine> {
  await assertCan(companyId, "master.edit");
  const values = parseInput(challanLrEwbFields, input);
  const issues = ewbRuleErrors(values, "");
  if (issues.length) throw new ValidationError(issues);
  return dbc.updateChallanLrEwb(companyId, id, expectedVersion, values);
}

/** Marks a Part-B task done. Needs master.edit. */
export async function markEwbTaskDone(
  companyId: string,
  taskId: string,
  note?: string | null,
): Promise<{ id: string; doneAt: string }> {
  await assertCan(companyId, "master.edit");
  const text = note?.trim().slice(0, 300) || null;
  return dbc.markEwbTaskDone(companyId, taskId, text);
}

/** Register rows (50 per page) for the filters. Reading is freight.view (RLS + the page check). */
export const listChallanRegister = (companyId: string, filters: ChallanListFilters, page: number) =>
  dbc.listChallanRegister(companyId, filters, { page });

/** Every row for the filters (capped at 5,000), for the Excel export. */
export const listChallanRegisterAll = (companyId: string, filters: ChallanListFilters) =>
  dbc.listChallanRegister(companyId, filters, { all: true });

export const getChallanPrintExtras = (companyId: string, id: string) =>
  dbc.getChallanPrintExtras(companyId, id);

export const getChallanInsights = (
  companyId: string,
  query: ChallanInsightQuery,
): Promise<ChallanInsights> => dbc.getChallanInsights(companyId, query);

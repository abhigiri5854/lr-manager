import type { ChallanLrPick, ChallanView } from "@/lib/types";
import {
  challanFields,
  challanRuleErrors,
  type ChallanInput,
} from "@/lib/validators/challan";
import { parseInput } from "./_store";
import * as dbc from "./db/challans";
import { ValidationError } from "./errors";
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
  return dbc.saveChallan(companyId, id, expectedVersion, values);
}

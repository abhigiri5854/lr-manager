import {
  hireSettingsFields,
  type HireSettings,
  type HireSettingsInput,
} from "@/lib/validators/hire-settings";
import { parseInput } from "./_store";
import * as dbs from "./db/hire-settings";
import { assertCan } from "./session";

// Tier-1 hire settings live on the database only (no mock half); the role rule is company.manage (Owner).

export const getHireSettings = (companyId: string): Promise<HireSettings> =>
  dbs.getHireSettings(companyId);

export async function updateHireSettings(
  companyId: string,
  expectedVersion: number,
  input: HireSettingsInput,
): Promise<HireSettings> {
  await assertCan(companyId, "company.manage");
  return dbs.updateHireSettings(companyId, expectedVersion, parseInput(hireSettingsFields, input));
}

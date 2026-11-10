// Tier-1 company settings on the database: one read, one combined update + audit.
import {
  HIRE_SETTING_COLUMNS,
  type HireSettings,
  type HireSettingsValues,
} from "@/lib/validators/hire-settings";
import { ConflictError, NotFoundError } from "../errors";
import { withUser, withUserRead } from "./conn";
import { audit, type Row } from "./rows";

const NUMERIC = new Set([
  "minMarginPct",
  "rateOutlierPct",
  "tdsRateIndividualPct",
  "tdsRateOtherPct",
  "tdsRateNoPanPct",
  "tdsThreshold",
  "shortageAllowancePct",
  "detentionRatePerDay",
  "latePodFee",
  "cashWarningLimit",
  "makerCheckerLimit",
]);

function toSettings(r: Row): HireSettings {
  const out: Record<string, unknown> = { version: r.version };
  for (const [key, col] of Object.entries(HIRE_SETTING_COLUMNS)) {
    const v = r[col];
    out[key] = NUMERIC.has(key) && v !== null && v !== undefined ? Number(v) : (v ?? null);
  }
  return out as HireSettings;
}

const cols = Object.values(HIRE_SETTING_COLUMNS).join(", ");

export async function getHireSettings(companyId: string): Promise<HireSettings> {
  return withUserRead(async (tx) => {
    const [r] = await tx`select version, ${tx.unsafe(cols)} from companies where id = ${companyId}`;
    if (!r) throw new NotFoundError("Company");
    return toSettings(r);
  });
}

/** Values already parsed by ../hire-settings.ts. */
export async function updateHireSettings(
  companyId: string,
  expectedVersion: number,
  v: HireSettingsValues,
): Promise<HireSettings> {
  const set: Row = {};
  for (const [key, col] of Object.entries(HIRE_SETTING_COLUMNS)) {
    const val = (v as Record<string, unknown>)[key];
    if (val !== undefined) set[col] = val;
  }
  return withUser(async (tx) => {
    const [r] = await tx`
      with cur as (select * from companies where id = ${companyId} for update)
      update companies t set ${tx(set)} from cur
       where t.id = cur.id and cur.version = ${expectedVersion}
      returning t.*, to_jsonb(cur) as before_row`;
    if (!r) {
      const [exists] = await tx`select 1 as x from companies where id = ${companyId}`;
      if (!exists) throw new NotFoundError("Company");
      throw new ConflictError();
    }
    const saved = toSettings(r);
    audit(tx, companyId, "companies", companyId, "update", toSettings(r.before_row), saved);
    return saved;
  });
}

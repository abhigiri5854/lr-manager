import { financialYear } from "@/lib/fy";
import type { Company } from "@/lib/types";
import { companyPatchSchema, companyRuleErrors, type CompanyPatch } from "@/lib/validators/company";
import {
  assertRules,
  clone,
  db,
  DEFAULT_SESSION,
  fail,
  findSeries,
  now,
  parseInput,
  today,
  writeAudit,
} from "./_store";
import { ConflictError, NotFoundError } from "./errors";

/** nextLrNo always comes from the number series (single source of truth). */
function withNextLrNo(c: Company): Company {
  const fy = financialYear(today());
  const series =
    findSeries(c.id, "lr", fy) ??
    db.numberSeries
      .filter((s) => s.companyId === c.id && s.series === "lr")
      .sort((a, b) => b.fy.localeCompare(a.fy))[0];
  return { ...clone(c), nextLrNo: series?.nextValue ?? null };
}

/** Companies the current user can work as. */
export async function listCompanies(): Promise<Company[]> {
  const ids = new Set(
    db.memberships
      .filter((m) => m.userId === DEFAULT_SESSION.userId && !m.cancelledAt)
      .map((m) => m.companyId),
  );
  return db.companies.filter((c) => ids.has(c.id) && !c.cancelledAt).map(withNextLrNo);
}

export async function getCompany(companyId: string): Promise<Company | null> {
  const c = db.companies.find((x) => x.id === companyId);
  return c ? withNextLrNo(c) : null;
}

/** Company profile save. Changing nextLrNo moves the LR number series (never backwards). */
export async function updateCompany(
  companyId: string,
  expectedVersion: number,
  patch: CompanyPatch,
): Promise<Company> {
  const current = db.companies.find((x) => x.id === companyId);
  if (!current) throw new NotFoundError("Company");
  if (current.version !== expectedVersion) throw new ConflictError();
  const p = parseInput(companyPatchSchema, patch);
  const { nextLrNo, ...fields } = p;
  const next: Company = {
    ...clone(current),
    ...fields,
    updatedAt: now(),
    version: current.version + 1,
  };
  assertRules(companyRuleErrors(next));

  if (nextLrNo !== undefined && nextLrNo !== null) {
    const fy = financialYear(today());
    const series = findSeries(companyId, "lr", fy);
    if (series && nextLrNo < series.nextValue) {
      fail("nextLrNo", `LR numbers below ${series.nextValue} may already be used`);
    }
    if (series) series.nextValue = nextLrNo;
    else db.numberSeries.push({ companyId, series: "lr", fy, nextValue: nextLrNo });
  }

  db.companies[db.companies.indexOf(current)] = next;
  writeAudit(companyId, "companies", companyId, "update", current, {
    ...next,
    nextLrNo: nextLrNo ?? current.nextLrNo,
  });
  return withNextLrNo(next);
}

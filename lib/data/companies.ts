import { financialYear } from "@/lib/fy";
import type { Company, Membership } from "@/lib/types";
import {
  companyCreateSchema,
  companyPatchSchema,
  companyRuleErrors,
  type CompanyCreateInput,
  type CompanyPatch,
} from "@/lib/validators/company";
import {
  assertRules,
  clone,
  db,
  fail,
  newId,
  now,
  parseInput,
  peekNumber,
  raiseNumber,
  today,
  writeAudit,
  authorStamp,
} from "./_store";
import { ConflictError, NotFoundError } from "./errors";
import { syncSelfParty } from "./parties";
import * as dbc from "./db/companies";
import { assertCan, getCurrentUserId } from "./session";
import { onDatabase } from "./source";

/** nextLrNo always comes from the number series (single source of truth). */
function withNextLrNo(c: Company): Company {
  return { ...clone(c), nextLrNo: peekNumber(c.id, "lr", financialYear(today())) };
}

/** Companies the current user can work as. */
export async function listCompanies(): Promise<Company[]> {
  if (onDatabase()) return dbc.listCompanies();
  const userId = await getCurrentUserId();
  const ids = new Set(
    db.memberships.filter((m) => m.userId === userId && !m.cancelledAt).map((m) => m.companyId),
  );
  return db.companies.filter((c) => ids.has(c.id) && !c.cancelledAt).map(withNextLrNo);
}

export async function getCompany(companyId: string): Promise<Company | null> {
  if (onDatabase()) return dbc.getCompany(companyId);
  const c = db.companies.find((x) => x.id === companyId);
  return c ? withNextLrNo(c) : null;
}

/** Next numbers in the current FY (for the live samples in Company profile). */
export type NumberingState = {
  fy: string;
  /** Null when the LR series was never set up. */
  lr: number | null;
  /** Next freight bill / tax invoice counter if numbers restart each FY, and if they run on. */
  freightBill: { ifReset: number; ifRunOn: number };
  taxInvoice: { ifReset: number; ifRunOn: number };
};

export async function getNumbering(companyId: string): Promise<NumberingState> {
  if (onDatabase()) return dbc.getNumbering(companyId);
  const fy = financialYear(today());
  const both = (series: "freight_bill" | "tax_invoice") => {
    const thisFy = db.numberSeries.find(
      (s) => s.companyId === companyId && s.series === series && s.fy === fy,
    );
    const latest = db.numberSeries
      .filter((s) => s.companyId === companyId && s.series === series)
      .sort((a, b) => b.fy.localeCompare(a.fy))[0];
    return {
      ifReset: thisFy?.nextValue ?? 1,
      ifRunOn: thisFy?.nextValue ?? latest?.nextValue ?? 1,
    };
  };
  return {
    fy,
    lr: peekNumber(companyId, "lr", fy),
    freightBill: both("freight_bill"),
    taxInvoice: both("tax_invoice"),
  };
}

/** Company profile save ("company.manage": Owner). Changing nextLrNo moves the LR series — never backwards. */
export async function updateCompany(
  companyId: string,
  expectedVersion: number,
  patch: CompanyPatch,
): Promise<Company> {
  await assertCan(companyId, "company.manage");
  if (onDatabase())
    return dbc.updateCompany(companyId, expectedVersion, parseInput(companyPatchSchema, patch));
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
  if (fields.gstin && fields.gstin !== current.gstin) assertGstinFree(fields.gstin, companyId);

  const fy = financialYear(today());
  const before = peekNumber(companyId, "lr", fy);
  if (nextLrNo !== undefined && nextLrNo !== null && nextLrNo !== before) {
    raiseNumber(companyId, "lr", fy, nextLrNo, "nextLrNo");
  }

  db.companies[db.companies.indexOf(current)] = next;
  writeAudit(
    companyId,
    "companies",
    companyId,
    "update",
    { ...current, nextLrNo: before },
    { ...next, nextLrNo: peekNumber(companyId, "lr", fy) },
  );
  // Our own party (used on LRs) always mirrors the profile.
  syncSelfParty(companyId);
  return withNextLrNo(next);
}

function assertGstinFree(gstin: string, exceptId?: string) {
  if (db.companies.some((c) => c.gstin === gstin && c.id !== exceptId && !c.cancelledAt)) {
    fail("gstin", "A company with this GSTIN already exists");
  }
}

/**
 * "+ Add company": creates the company, its self party and its number series for this FY,
 * and makes the current user its Owner. Everything else starts blank or at safe defaults.
 */
export async function createCompany(input: CompanyCreateInput): Promise<Company> {
  const userId = await getCurrentUserId();
  const v = parseInput(companyCreateSchema, input);
  assertRules(companyRuleErrors(v));
  if (onDatabase()) return dbc.createCompany(v);
  assertGstinFree(v.gstin);

  const t = now();
  const company: Company = {
    id: newId(),
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...v,
    office: "",
    email: null,
    website: null,
    mobile1: null,
    mobile2: null,
    udyam: null,
    bank: null,
    invoiceTitle: "FREIGHT INVOICE",
    invoiceNote: null,
    freightBillPrefix: "",
    taxInvoicePrefix: "",
    invoiceRoundOff: true,
    numberingResetsYearly: true,
    freightGstRateBp: 500,
    signatoryName: null,
    lrPrefix: "",
    nextLrNo: null,
    jurisdiction: null,
    podDays: null,
    podPenaltyPerDay: null,
    lrCopies: ["Consignor", "Consignee", "Driver", "Office"],
    detention: null,
    lrTerms: null,
    logoUrl: null,
    useLogoWatermark: false,
    signatureUrl: null,
  };
  db.companies.push(company);
  writeAudit(company.id, "companies", company.id, "create", null, company);

  const membership: Membership = {
    id: newId(),
    companyId: company.id,
    userId,
    role: "owner",
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...authorStamp(),
  };
  db.memberships.push(membership);
  writeAudit(company.id, "memberships", membership.id, "create", null, membership);

  const fy = financialYear(today());
  for (const series of ["lr", "freight_bill", "tax_invoice"] as const) {
    db.numberSeries.push({ companyId: company.id, series, fy, nextValue: 1 });
  }
  syncSelfParty(company.id);
  return withNextLrNo(company);
}

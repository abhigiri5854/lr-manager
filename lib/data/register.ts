// "Register a new company" (login page): the company, its first Owner login, its self party and
// number series in one go. A login belongs to exactly one company, so this is the only way a
// company is created — there is no "add company" inside the app.
import { randomUUID } from "node:crypto";
import { ensureAuthUser } from "@/db/auth-admin";
import { financialYear } from "@/lib/fy";
import type { Company, Membership, User } from "@/lib/types";
import {
  companyRuleErrors,
  registerCompanySchema,
  type RegisterCompanyInput,
} from "@/lib/validators/company";
import { assertRules, auditChanges, db, fail, hashPassword, newId, now, parseInput, today, writeAudit } from "./_store";
import { asService } from "./db/conn";
import { assertGstinFree, codeTaken } from "./companies";
import { syncSelfParty } from "./parties";
import { onDatabase } from "./source";

/** Same message for each field the person can fix. */
const CODE_TAKEN = "This company code is already taken";
const GSTIN_TAKEN = "A company with this GSTIN already exists";

export async function registerCompany(
  input: RegisterCompanyInput,
): Promise<{ companyId: string }> {
  const v = parseInput(registerCompanySchema, input);
  assertRules(companyRuleErrors(v));
  const ownerId = onDatabase() ? randomUUID() : newId();
  const companyId = onDatabase()
    ? await registerOnDatabase(v, ownerId)
    : registerInMemory(v, ownerId);
  return { companyId };
}

type Parsed = ReturnType<typeof registerCompanySchema.parse>;

async function registerOnDatabase(v: Parsed, ownerId: string): Promise<string> {
  // Checked first so the person sees a field error before any Auth user is made.
  await asService(async (tx) => {
    const [c] = await tx`select exists (select 1 from companies where code = ${v.code}
                                          and cancelled_at is null) as code_taken,
                                exists (select 1 from companies where gstin = ${v.gstin}
                                          and cancelled_at is null) as gstin_taken`;
    if (c.code_taken) fail("code", CODE_TAKEN);
    if (c.gstin_taken) fail("gstin", GSTIN_TAKEN);
  });
  await ensureAuthUser({
    id: ownerId,
    email: `u-${ownerId}@lrm.invalid`,
    emailPlaceholder: true,
    contactEmail: v.ownerEmail ?? null,
    password: v.password,
    name: v.ownerName,
    mobile: v.ownerMobile,
  });
  return asService(async (tx) => {
    const [{ id }] = await tx`select app.register_company(${ownerId}, ${v.code}, ${v.label}, ${v.name},
                                                           ${v.city}, ${v.gstin}, ${v.pan}) as id`;
    const log = async (table: string, recordId: string, row: object) => {
      await tx`insert into audit_log (company_id, actor, user_id, table_name, record_id, action, changes)
               values (${id}, 'user', ${ownerId}, ${table}, ${recordId}, 'create',
                       ${tx.json(auditChanges(null, row) as never)})`;
    };
    await log("companies", id, { code: v.code, label: v.label, name: v.name, city: v.city, gstin: v.gstin, pan: v.pan });
    const [m] = await tx`select id, role from memberships where company_id = ${id} and user_id = ${ownerId}`;
    await log("memberships", m.id, { userId: ownerId, role: m.role });
    return id as string;
  });
}

function registerInMemory(v: Parsed, ownerId: string): string {
  if (codeTaken(v.code)) fail("code", CODE_TAKEN);
  try {
    assertGstinFree(v.gstin);
  } catch {
    fail("gstin", GSTIN_TAKEN);
  }
  const t = now();
  const owner: User = {
    id: ownerId,
    createdAt: t,
    updatedAt: t,
    name: v.ownerName,
    mobile: v.ownerMobile,
    email: v.ownerEmail ?? null,
    lastLoginAt: null,
  };
  db.users.push(owner);
  db.credentials.push(hashPassword(ownerId, v.password));
  const company: Company = {
    id: newId(),
    createdAt: t,
    updatedAt: t,
    version: 1,
    code: v.code,
    label: v.label,
    name: v.name,
    city: v.city,
    gstin: v.gstin,
    pan: v.pan,
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
  const membership: Membership = {
    id: newId(),
    companyId: company.id,
    userId: ownerId,
    role: "owner",
    createdAt: t,
    updatedAt: t,
    version: 1,
    createdBy: ownerId,
    updatedBy: ownerId,
  };
  db.memberships.push(membership);
  const fy = financialYear(today());
  for (const series of ["lr", "freight_bill", "tax_invoice"] as const) {
    db.numberSeries.push({ companyId: company.id, series, fy, nextValue: 1 });
  }
  syncSelfParty(company.id);
  writeAudit(company.id, "companies", company.id, "create", null, company);
  writeAudit(company.id, "memberships", membership.id, "create", null, membership);
  return company.id;
}

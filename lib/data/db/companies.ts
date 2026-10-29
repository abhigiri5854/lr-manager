// Companies, number series and "+ Add company" on the database (DATA_SOURCE=db).
// Same behaviour as the mock half of ../companies.ts. The self party follows the company by
// trigger (f_self_party); its change is audited here, as the mock does.
import { financialYear } from "@/lib/fy";
import type { Company } from "@/lib/types";
import type { z } from "zod";
import {
  companyRuleErrors,
  type companyCreateSchema,
  type companyPatchSchema,
} from "@/lib/validators/company";
import { assertRules, fail, today } from "../_store";
import { ConflictError, NotFoundError } from "../errors";
import type { NumberingState } from "../companies";
import { withUser, type Tx } from "./conn";
import { audit, toCompany, toMembership, toParty, type Row } from "./rows";
import { pathFromUrl } from "./storage";
import { columns } from "./write";

const COMPANY_COLUMNS: Partial<Record<keyof Company, string>> = {
  label: "label",
  name: "name",
  city: "city",
  office: "office",
  email: "email",
  website: "website",
  mobile1: "mobile1",
  mobile2: "mobile2",
  gstin: "gstin",
  pan: "pan",
  udyam: "udyam",
  invoiceTitle: "invoice_title",
  invoiceNote: "invoice_note",
  freightBillPrefix: "freight_bill_prefix",
  taxInvoicePrefix: "tax_invoice_prefix",
  invoiceRoundOff: "invoice_round_off",
  numberingResetsYearly: "numbering_resets_yearly",
  freightGstRateBp: "freight_gst_rate_bp",
  signatoryName: "signatory_name",
  lrPrefix: "lr_prefix",
  jurisdiction: "jurisdiction",
  podDays: "pod_days",
  podPenaltyPerDay: "pod_penalty_per_day_paise",
  lrCopies: "lr_copies",
  detention: "detention",
  lrTerms: "lr_terms",
  useLogoWatermark: "use_logo_watermark",
};

const fyNow = () => financialYear(today());

async function peekLr(tx: Tx, companyId: string, fy: string): Promise<number | null> {
  const [r] = await tx`select app.peek_number(${companyId}, 'lr', ${fy}) as n`;
  return r.n === null ? null : Number(r.n);
}

const COMPANY_SELECT = (tx: Tx, fy: string) =>
  tx`select c.*, app.peek_number(c.id, 'lr', ${fy}) as next_lr_no from companies c`;

const company = (r: Row) => toCompany(r, r.next_lr_no === null ? null : Number(r.next_lr_no));

export async function listCompanies(): Promise<Company[]> {
  return withUser(async (tx) => {
    const rows = await tx`${COMPANY_SELECT(tx, fyNow())}
      join memberships m on m.company_id = c.id
     where m.user_id = auth.uid() and m.cancelled_at is null and c.cancelled_at is null
     order by m.created_at, m.id`;
    return rows.map(company);
  });
}

export async function getCompany(companyId: string): Promise<Company | null> {
  return withUser(async (tx) => {
    const [r] = await tx`${COMPANY_SELECT(tx, fyNow())} where c.id = ${companyId}`;
    return r ? company(r) : null;
  });
}

export async function getNumbering(companyId: string): Promise<NumberingState> {
  const fy = fyNow();
  return withUser(async (tx) => {
    const rows = await tx`select series, fy, next_no from number_series
                           where company_id = ${companyId} order by fy desc`;
    const both = (series: "freight_bill" | "tax_invoice") => {
      const mine = rows.filter((r) => r.series === series);
      const thisFy = mine.find((r) => r.fy === fy);
      return {
        ifReset: thisFy?.next_no ?? 1,
        ifRunOn: thisFy?.next_no ?? mine[0]?.next_no ?? 1,
      };
    };
    return {
      fy,
      lr: await peekLr(tx, companyId, fy),
      freightBill: both("freight_bill"),
      taxInvoice: both("tax_invoice"),
    };
  });
}

async function assertGstinFree(tx: Tx, gstin: string, exceptId?: string) {
  const [r] = await tx`select app.company_gstin_taken(${gstin}, ${exceptId ?? null}) as taken`;
  if (r.taken) fail("gstin", "A company with this GSTIN already exists");
}

function imagePath(
  bucket: "logos" | "signatures",
  companyId: string,
  url: string | null | undefined,
) {
  try {
    return pathFromUrl(bucket, companyId, url);
  } catch {
    fail(bucket === "logos" ? "logoUrl" : "signatureUrl", "Upload the file again");
  }
}

/** Patch already parsed by ../companies.ts. */
export async function updateCompany(
  companyId: string,
  expectedVersion: number,
  p: z.output<typeof companyPatchSchema>,
): Promise<Company> {
  const fy = fyNow();
  return withUser(async (tx) => {
    const [row] = await tx`${COMPANY_SELECT(tx, fy)} where c.id = ${companyId} for update of c`;
    if (!row) throw new NotFoundError("Company");
    if (row.version !== expectedVersion) throw new ConflictError();
    const current = company(row);
    const { nextLrNo, ...rest } = p;
    const fields = rest as Partial<Company>;
    const next: Company = { ...current, ...fields } as Company;
    assertRules(companyRuleErrors(next));
    if (fields.gstin && fields.gstin !== current.gstin)
      await assertGstinFree(tx, fields.gstin, companyId);

    const before = current.nextLrNo;
    if (nextLrNo !== undefined && nextLrNo !== null && nextLrNo !== before) {
      if (before !== null && nextLrNo < before) {
        fail(
          "nextLrNo",
          `Can't go below ${before} — numbers up to ${before - 1} may already be used`,
        );
      }
      await tx`select app.raise_number(${companyId}, 'lr', ${fy}, ${nextLrNo})`;
    }

    const set: Row = columns(fields, COMPANY_COLUMNS);
    if ("bank" in fields) {
      const b = fields.bank ?? null;
      Object.assign(set, {
        bank_account_name: b?.accountName ?? null,
        bank_name: b?.bankName ?? null,
        bank_account_no: b?.accountNo ?? null,
        bank_ifsc: b?.ifsc ?? null,
      });
    }
    if ("logoUrl" in fields) set.logo_path = imagePath("logos", companyId, fields.logoUrl);
    if ("signatureUrl" in fields) {
      set.signature_path = imagePath("signatures", companyId, fields.signatureUrl);
    }

    const [selfBefore] =
      await tx`select * from parties where company_id = ${companyId} and is_self`;
    if (Object.keys(set).length > 0) {
      const [updated] = await tx`update companies set ${tx(set)}
                                  where id = ${companyId} and version = ${expectedVersion} returning id`;
      if (!updated) throw new ConflictError();
    }
    const [savedRow] = await tx`${COMPANY_SELECT(tx, fy)} where c.id = ${companyId}`;
    const saved = company(savedRow);
    await audit(
      tx,
      companyId,
      "companies",
      companyId,
      "update",
      { ...current, nextLrNo: before },
      saved,
    );

    // Our own party (used on LRs) mirrors the profile — the trigger copied it; audit that too.
    const [selfAfter] = await tx`select * from parties where company_id = ${companyId} and is_self`;
    if (selfBefore && selfAfter && selfAfter.version !== selfBefore.version) {
      await audit(
        tx,
        companyId,
        "parties",
        selfAfter.id,
        "update",
        toParty(selfBefore),
        toParty(selfAfter),
      );
    }
    return saved;
  });
}

/**
 * "+ Add company": app.create_company makes the company, its Owner membership (the current
 * user), its self party and this FY's number series in one transaction.
 */
export async function createCompany(v: z.output<typeof companyCreateSchema>): Promise<Company> {
  return withUser(async (tx) => {
    await assertGstinFree(tx, v.gstin);
    const [{ id }] = await tx`select app.create_company(${v.label}, ${v.name}, ${v.city},
                                                         ${v.gstin}, ${v.pan}) as id`;
    const [c] = await tx`${COMPANY_SELECT(tx, fyNow())} where c.id = ${id}`;
    const created = company(c);
    await audit(tx, id, "companies", id, "create", null, created);
    const [m] =
      await tx`select * from memberships where company_id = ${id} and user_id = auth.uid()`;
    await audit(tx, id, "memberships", m.id, "create", null, toMembership(m));
    const [self] = await tx`select * from parties where company_id = ${id} and is_self`;
    await audit(tx, id, "parties", self.id, "create", null, toParty(self));
    return created;
  });
}

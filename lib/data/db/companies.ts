// Companies and number series on the database (DATA_SOURCE=db).
// Same behaviour as the mock half of ../companies.ts. The self party follows the company by
// trigger (f_self_party); its change is audited here, as the mock does.
import { financialYear } from "@/lib/fy";
import type { Company, Party } from "@/lib/types";
import type { z } from "zod";
import {
  companyRuleErrors,
  type companyPatchSchema,
} from "@/lib/validators/company";
import { assertRules, auditChanges, fail, today } from "../_store";
import { ConflictError, NotFoundError } from "../errors";
import type { NumberingState } from "../companies";
import { withCommit, withUser, withUserRead, type Tx } from "./conn";
import { audit, toCompany, toParty, type Row } from "./rows";
import { pathFromUrl } from "./storage";
import { columns, type Fragment } from "./write";

const COMPANY_COLUMNS: Partial<Record<keyof Company, string>> = {
  code: "code",
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

export async function getCompany(companyId: string): Promise<Company | null> {
  return withUserRead(async (tx) => {
    const [r] = await tx`${COMPANY_SELECT(tx, fyNow())} where c.id = ${companyId}`;
    return r ? company(r) : null;
  });
}

export async function getNumbering(companyId: string): Promise<NumberingState> {
  const fy = fyNow();
  return withUserRead(async (tx) => {
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

/**
 * Patch already parsed by ../companies.ts. One statement locks the company, checks the GSTIN,
 * updates it at the expected version and returns before / after (with what the f_self_party
 * trigger copies onto our own party); the LR number raise and the audit rows go with the commit.
 */
export async function updateCompany(
  companyId: string,
  expectedVersion: number,
  p: z.output<typeof companyPatchSchema>,
): Promise<Company> {
  const fy = fyNow();
  const { nextLrNo, ...rest } = p;
  const fields = rest as Partial<Company>;
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

  return withUser(async (tx) => {
    const ok = tx`cur.version = ${expectedVersion} and not exists (select 1 from checks)`;
    const upd =
      Object.keys(set).length > 0
        ? tx`update companies t set ${tx(set)} from cur where t.id = cur.id and ${ok}
              returning t.*, cur.next_lr_no`
        : tx`select cur.* from cur where ${ok}`;
    const gstinCheck = fields.gstin
      ? tx`select 'gstin'::text as field, 'A company with this GSTIN already exists'::text as msg
            where ${fields.gstin} is distinct from (select gstin from cur)
              and app.company_gstin_taken(${fields.gstin}, ${companyId})`
      : tx`select null::text as field, null::text as msg where false`;
    const codeCheck = fields.code
      ? tx`select 'code'::text as field, 'This company code is already taken'::text as msg
            where ${fields.code} is distinct from (select code from cur)
              and app.company_code_taken(${fields.code}, ${companyId})`
      : tx`select null::text as field, null::text as msg where false`;
    // Our own party before the trigger touches it (sent first, same round trip).
    const [[selfBefore], rows] = await Promise.all([
      tx`select * from parties where company_id = ${companyId} and is_self`,
      tx`
        with cur as (select c.*, app.peek_number(c.id, 'lr', ${fy}) as next_lr_no from companies c
                      where c.id = ${companyId} for update of c),
             checks as (${gstinCheck} union all ${codeCheck}),
             upd as (${upd})
        select 'before' as k,
               (select json_agg(json_build_object('field', field, 'msg', msg)) from checks) as problems,
               cur.* ${selfMirror(tx, tx`cur`)}
          from cur
        union all
        select 'after', null, upd.* ${selfMirror(tx, tx`upd`)} from upd`,
    ]);
    const beforeRow = rows.find((r) => r.k === "before");
    const afterRow = rows.find((r) => r.k === "after");
    if (!beforeRow) throw new NotFoundError("Company");
    if (beforeRow.version !== expectedVersion) throw new ConflictError();
    const current = company(beforeRow);
    assertRules(companyRuleErrors({ ...current, ...fields } as Company));
    const problem = beforeRow.problems?.[0];
    if (problem) fail(problem.field, problem.msg);
    if (!afterRow) throw new ConflictError();

    const before = current.nextLrNo;
    const raise = nextLrNo !== undefined && nextLrNo !== null && nextLrNo !== before;
    if (raise) {
      if (before !== null && nextLrNo < before) {
        fail(
          "nextLrNo",
          `Can't go below ${before} — numbers up to ${before - 1} may already be used`,
        );
      }
      withCommit(tx, tx`select app.raise_number(${companyId}, 'lr', ${fy}, ${nextLrNo})`);
    }
    const saved = toCompany(afterRow, raise ? nextLrNo : before);
    audit(tx, companyId, "companies", companyId, "update", { ...current, nextLrNo: before }, saved);

    // Our own party (used on LRs) mirrors the profile — the trigger copied it; audit that too.
    if (selfBefore) {
      const from = toParty(selfBefore);
      const to: Party = {
        ...from,
        name: afterRow.self_name,
        place: afterRow.self_place,
        gstin: afterRow.self_gstin,
        pan: afterRow.self_pan,
        phone: afterRow.self_phone,
        address: afterRow.self_address,
        stateCode: afterRow.self_state_code,
        pincode: afterRow.self_pincode,
      };
      if (auditChanges(from, to).length > 0) {
        audit(tx, companyId, "parties", from.id, "update", from, to);
      }
    }
    return saved;
  });
}

/** What app.tg_company_self_party copies from a company row onto its self party. */
const selfMirror = (tx: Tx, a: Fragment) => tx`,
  ${a}.name as self_name, nullif(${a}.city, '') as self_place, ${a}.gstin as self_gstin,
  ${a}.pan as self_pan, ${a}.mobile1 as self_phone, nullif(${a}.office, '') as self_address,
  left(${a}.gstin, 2) as self_state_code, app.self_party_pincode(${a}.office) as self_pincode`;

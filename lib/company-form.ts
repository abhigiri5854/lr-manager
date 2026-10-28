// Company profile form: what the inputs hold, how it becomes a CompanyPatch, and the
// live sample numbers / preview lines. Pure functions so they can be tested.
import { formatPaise, parseRupees } from "@/lib/format";
import type { Company } from "@/lib/types";
import type { RuleError } from "@/lib/validators/common";
import {
  companyPatchSchema,
  companyRuleErrors,
  type CompanyPatch,
  type LR_COPY_OPTIONS,
} from "@/lib/validators/company";
import { formatInvoiceNo } from "@/lib/validators/invoice";

export type CompanyForm = {
  name: string;
  label: string;
  city: string;
  office: string;
  email: string;
  website: string;
  mobile1: string;
  mobile2: string;
  gstin: string;
  pan: string;
  udyam: string;
  accountName: string;
  bankName: string;
  accountNo: string;
  ifsc: string;
  lrPrefix: string;
  nextLrNo: string;
  freightBillPrefix: string;
  taxInvoicePrefix: string;
  numberingResetsYearly: boolean;
  invoiceTitle: string;
  invoiceNote: string;
  signatoryName: string;
  invoiceRoundOff: boolean;
  freightGstRateBp: string;
  jurisdiction: string;
  podDays: string;
  podPenalty: string;
  detention: string;
  lrCopies: (typeof LR_COPY_OPTIONS)[number][];
  lrTerms: string;
  logoUrl: string | null;
  useLogoWatermark: boolean;
  signatureUrl: string | null;
};

export function formFromCompany(c: Company): CompanyForm {
  return {
    name: c.name,
    label: c.label,
    city: c.city,
    office: c.office,
    email: c.email ?? "",
    website: c.website ?? "",
    mobile1: c.mobile1 ?? "",
    mobile2: c.mobile2 ?? "",
    gstin: c.gstin,
    pan: c.pan,
    udyam: c.udyam ?? "",
    accountName: c.bank?.accountName ?? "",
    bankName: c.bank?.bankName ?? "",
    accountNo: c.bank?.accountNo ?? "",
    ifsc: c.bank?.ifsc ?? "",
    lrPrefix: c.lrPrefix,
    nextLrNo: c.nextLrNo === null ? "" : String(c.nextLrNo),
    freightBillPrefix: c.freightBillPrefix,
    taxInvoicePrefix: c.taxInvoicePrefix,
    numberingResetsYearly: c.numberingResetsYearly,
    invoiceTitle: c.invoiceTitle,
    invoiceNote: c.invoiceNote ?? "",
    signatoryName: c.signatoryName ?? "",
    invoiceRoundOff: c.invoiceRoundOff,
    freightGstRateBp: String(c.freightGstRateBp),
    jurisdiction: c.jurisdiction ?? "",
    podDays: c.podDays === null ? "" : String(c.podDays),
    podPenalty: c.podPenaltyPerDay === null ? "" : formatPaise(c.podPenaltyPerDay),
    detention: c.detention ?? "",
    lrCopies: c.lrCopies.filter((x): x is CompanyForm["lrCopies"][number] =>
      ["Consignor", "Consignee", "Driver", "Office"].includes(x),
    ),
    lrTerms: c.lrTerms ?? "",
    logoUrl: c.logoUrl,
    useLogoWatermark: c.useLogoWatermark,
    signatureUrl: c.signatureUrl,
  };
}

/** "" → null; digits → number; anything else → NaN (the schema reports it). */
const wholeNumber = (s: string) => {
  const t = s.replace(/[\s,]/g, "");
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
};

export function patchFromForm(f: CompanyForm): CompanyPatch {
  const bankParts = [f.accountName, f.bankName, f.accountNo, f.ifsc];
  const penalty = parseRupees(f.podPenalty);
  return {
    name: f.name,
    label: f.label,
    city: f.city,
    office: f.office,
    email: f.email.trim(),
    website: f.website,
    mobile1: f.mobile1,
    mobile2: f.mobile2,
    gstin: f.gstin,
    pan: f.pan,
    udyam: f.udyam.trim(),
    bank: bankParts.every((p) => p.trim() === "")
      ? null
      : { accountName: f.accountName, bankName: f.bankName, accountNo: f.accountNo, ifsc: f.ifsc },
    lrPrefix: f.lrPrefix,
    nextLrNo: wholeNumber(f.nextLrNo),
    freightBillPrefix: f.freightBillPrefix,
    taxInvoicePrefix: f.taxInvoicePrefix,
    numberingResetsYearly: f.numberingResetsYearly,
    invoiceTitle: f.invoiceTitle,
    invoiceNote: f.invoiceNote,
    signatoryName: f.signatoryName,
    invoiceRoundOff: f.invoiceRoundOff,
    freightGstRateBp: Number(f.freightGstRateBp),
    jurisdiction: f.jurisdiction,
    podDays: wholeNumber(f.podDays),
    // undefined (unreadable) is caught in validateForm before it gets here.
    podPenaltyPerDay: penalty ?? null,
    detention: f.detention,
    lrCopies: f.lrCopies,
    lrTerms: f.lrTerms,
    logoUrl: f.logoUrl,
    useLogoWatermark: f.useLogoWatermark,
    signatureUrl: f.signatureUrl,
  };
}

/** Same checks the server runs, so most mistakes show without a round trip. */
export function validateForm(f: CompanyForm, lowestNextLrNo: number | null): RuleError[] {
  const errors: RuleError[] = [];
  if (parseRupees(f.podPenalty) === undefined) {
    errors.push({ path: "podPenaltyPerDay", message: "Enter an amount like 50 or 50.00" });
  }
  const patch = patchFromForm(f);
  const parsed = companyPatchSchema.safeParse(patch);
  if (!parsed.success) {
    for (const i of parsed.error.issues)
      errors.push({ path: i.path.join("."), message: i.message });
  } else {
    errors.push(...companyRuleErrors({ gstin: parsed.data.gstin!, pan: parsed.data.pan! }));
  }
  const next = patch.nextLrNo;
  if (typeof next === "number" && lowestNextLrNo !== null && next < lowestNextLrNo) {
    errors.push({
      path: "nextLrNo",
      message: `Can't go below ${lowestNextLrNo} — numbers up to ${lowestNextLrNo - 1} may already be used`,
    });
  }
  return errors;
}

// ---------- live samples ----------
const cleanPrefix = (p: string) => p.trim().toUpperCase();

export function sampleLrNo(f: CompanyForm, seriesNext: number | null): string | null {
  const n = wholeNumber(f.nextLrNo) ?? seriesNext;
  return n === null || Number.isNaN(n) ? null : `${cleanPrefix(f.lrPrefix)}${n}`;
}

export function sampleFreightBillNo(prefix: string, counter: number): string {
  return `${cleanPrefix(prefix)}${String(counter).padStart(3, "0")}`;
}

export function sampleTaxInvoiceNo(prefix: string, counter: number): string | null {
  return formatInvoiceNo(cleanPrefix(prefix), counter);
}

// ---------- preview lines ----------
export function contactLine(f: CompanyForm): string {
  const phones = [f.mobile1, f.mobile2]
    .map((m) => m.trim())
    .filter(Boolean)
    .join(" / ");
  return [f.email.trim(), phones].filter(Boolean).join(" · ");
}

export function taxLine(f: CompanyForm): string {
  return [
    f.gstin.trim() && `GSTIN ${f.gstin.trim().toUpperCase()}`,
    f.pan.trim() && `PAN ${f.pan.trim().toUpperCase()}`,
    f.udyam.trim() && `MSME ${f.udyam.trim().toUpperCase()}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function bankLine(f: CompanyForm): string {
  if (!f.accountNo.trim()) return "not set yet";
  return [
    f.accountName.trim(),
    f.bankName.trim(),
    `A/c ${f.accountNo.trim()}`,
    f.ifsc.trim() && `IFSC ${f.ifsc.trim().toUpperCase()}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function lrTermsLine(f: CompanyForm): string {
  const days = wholeNumber(f.podDays);
  const penalty = parseRupees(f.podPenalty);
  const pod =
    typeof days === "number" && !Number.isNaN(days)
      ? `POD within ${days} days${penalty ? `, ₹${formatPaise(penalty).replace(/\.00$/, "")}/day late` : ""}`
      : "POD days [not set]";
  return [pod, f.detention.trim() && `Detention ${f.detention.trim()}`].filter(Boolean).join(" · ");
}

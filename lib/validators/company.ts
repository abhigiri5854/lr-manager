import { z } from "zod";
import { taxInvoicePrefixSchema } from "./invoice";
import {
  gstinSchema,
  mobileSchema,
  optional,
  optionalText,
  paise,
  panMatchesGstin,
  panSchema,
  text,
  type RuleError,
} from "./common";

// ---------- bank ----------
export const IFSC_SHAPE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const bankAccountSchema = z.object({
  accountName: text(100),
  bankName: text(100),
  accountNo: z
    .string()
    .transform((v) => v.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^\d{9,18}$/, "Account number is 9–18 digits")),
  ifsc: z
    .string()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().regex(IFSC_SHAPE, "IFSC looks like HDFC0001234")),
});

// The first 4 IFSC letters name the bank. Only common banks are listed; others aren't checked.
const BANK_IFSC: Array<[RegExp, string]> = [
  [/\bHDFC\b/, "HDFC"],
  [/\bICICI\b/, "ICIC"],
  [/\bAXIS\b/, "UTIB"],
  [/\bKOTAK\b/, "KKBK"],
  [/\bYES BANK\b/, "YESB"],
  [/\bINDUSIND\b/, "INDB"],
  [/\bIDFC\b/, "IDFB"],
  [/\bIDBI\b/, "IBKL"],
  [/\bFEDERAL\b/, "FDRL"],
  [/\bCANARA\b/, "CNRB"],
  [/\bUCO\b/, "UCBA"],
  [/\b(SBI|STATE BANK OF INDIA)\b/, "SBIN"],
  [/\b(PNB|PUNJAB NATIONAL)\b/, "PUNB"],
  [/\b(BOB|BANK OF BARODA)\b/, "BARB"],
  [/\bBANK OF INDIA\b/, "BKID"],
  [/\bBANK OF MAHARASHTRA\b/, "MAHB"],
  [/\bUNION BANK\b/, "UBIN"],
  [/\bCENTRAL BANK\b/, "CBIN"],
  [/\bINDIAN OVERSEAS\b/, "IOBA"],
  [/\bINDIAN BANK\b/, "IDIB"],
];

/**
 * A soft warning (not an error) when the IFSC doesn't belong to the bank named,
 * e.g. "HDFC BANK" with "SBIN0001234". Null when they match or the bank isn't known.
 */
export function ifscBankWarning(bankName: string, ifsc: string): string | null {
  const code = ifsc.replace(/\s+/g, "").toUpperCase();
  if (!IFSC_SHAPE.test(code)) return null;
  const name = ` ${bankName.toUpperCase().replace(/[^A-Z ]/g, " ")} `;
  const hit = BANK_IFSC.find(([re]) => re.test(name));
  if (!hit || code.startsWith(hit[1])) return null;
  return `${bankName.trim()} IFSC codes start with ${hit[1]}0 — check the IFSC or bank name.`;
}

// ---------- registration ----------
/** "udyam - jh-01-0050188" → "UDYAM-JH-01-0050188" */
export function normaliseUdyam(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}
export const UDYAM_SHAPE = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const udyamSchema = z
  .string()
  .transform(normaliseUdyam)
  .pipe(z.string().regex(UDYAM_SHAPE, "UDYAM number looks like UDYAM-BR-01-0012345"));

// ---------- documents ----------
/** GTA forward-charge GST rates (basis points) a freight bill can carry. */
export const FREIGHT_GST_RATES_BP = [500, 1200, 1800] as const;

/** Logos and signatures must be files uploaded through lib/data/uploads. */
const uploadUrl = z
  .string()
  .regex(/^\/uploads\/[0-9a-f-]{36}(\?[^\s"'<>]*)?$/, "Upload the file again");

export const LR_COPY_OPTIONS = ["Consignor", "Consignee", "Driver", "Office"] as const;

const prefix = (max: number) =>
  z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(
      z
        .string()
        .max(max, `At most ${max} characters`)
        .regex(/^[A-Z0-9/-]*$/, "Only A-Z, 0-9, / and -"),
    );

export const companyFields = z.object({
  label: text(60),
  name: text(200),
  city: text(60),
  office: text(500),
  email: optional(z.email("Email looks wrong")),
  website: optionalText(200),
  mobile1: optional(mobileSchema),
  mobile2: optional(mobileSchema),
  gstin: gstinSchema,
  pan: panSchema,
  udyam: optional(udyamSchema),
  bank: optional(bankAccountSchema),
  invoiceTitle: text(60),
  invoiceNote: optionalText(300),
  freightBillPrefix: prefix(30),
  taxInvoicePrefix: taxInvoicePrefixSchema,
  invoiceRoundOff: z.boolean(),
  numberingResetsYearly: z.boolean(),
  freightGstRateBp: z
    .number()
    .refine((n) => (FREIGHT_GST_RATES_BP as readonly number[]).includes(n), "Pick 5%, 12% or 18%"),
  signatoryName: optionalText(100),
  lrPrefix: prefix(10),
  nextLrNo: optional(
    z.number("Enter a whole number").int("Enter a whole number").positive("Must be 1 or more"),
  ),
  jurisdiction: optionalText(60),
  podDays: optional(
    z.number("Enter days").int("Whole days only").min(0).max(365, "At most 365 days"),
  ),
  podPenaltyPerDay: optional(paise),
  lrCopies: z.array(z.enum(LR_COPY_OPTIONS)).max(LR_COPY_OPTIONS.length),
  detention: optionalText(300),
  lrTerms: optionalText(2000),
  logoUrl: optional(uploadUrl),
  useLogoWatermark: z.boolean(),
  signatureUrl: optional(uploadUrl),
});
export const companyPatchSchema = companyFields.partial();
export type CompanyPatch = z.input<typeof companyPatchSchema>;

/** "+ Add company": the minimum needed to issue documents. */
export const companyCreateSchema = companyFields.pick({
  name: true,
  label: true,
  city: true,
  gstin: true,
  pan: true,
});
export type CompanyCreateInput = z.input<typeof companyCreateSchema>;

export function companyRuleErrors(c: { gstin: string; pan: string }): RuleError[] {
  return panMatchesGstin(c.pan, c.gstin)
    ? []
    : [{ path: "pan", message: "PAN doesn't match GSTIN characters 3–12" }];
}

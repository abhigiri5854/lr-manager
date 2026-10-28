import { z } from "zod";
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

export const bankAccountSchema = z.object({
  accountName: text(100),
  bankName: text(100),
  accountNo: z.string().regex(/^\d{9,18}$/, "Account number is 9–18 digits"),
  ifsc: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks like HDFC0001234")),
});

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
  udyam: optionalText(40),
  bank: optional(bankAccountSchema),
  invoiceTitle: text(60),
  invoiceNote: optionalText(300),
  freightBillPrefix: z.string().trim().max(30),
  signatoryName: optionalText(100),
  lrPrefix: z.string().trim().max(10),
  nextLrNo: optional(z.number().int().positive()),
  jurisdiction: optionalText(60),
  podDays: optional(z.number().int().min(0).max(365)),
  podPenaltyPerDay: optional(paise),
  lrCopies: z.array(text(30)).max(6),
  detention: optionalText(300),
  lrTerms: optionalText(2000),
  logoUrl: optionalText(500),
  useLogoWatermark: z.boolean(),
  signatureUrl: optionalText(500),
});
export const companyPatchSchema = companyFields.partial();
export type CompanyPatch = z.input<typeof companyPatchSchema>;

export function companyRuleErrors(c: { gstin: string; pan: string }): RuleError[] {
  return panMatchesGstin(c.pan, c.gstin)
    ? []
    : [{ path: "pan", message: "PAN doesn't match GSTIN characters 3–12" }];
}

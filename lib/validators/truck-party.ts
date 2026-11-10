import { z } from "zod";
import {
  gstinSchema,
  isoDate,
  mobileSchema,
  optional,
  optionalText,
  panMatchesGstin,
  panSchema,
  text,
  type RuleError,
} from "./common";

const accountNoSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{9,18}$/, "Account number is 9–18 digits"));
const ifscSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks like HDFC0001234"));
const upiSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().regex(/^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,}$/, "UPI ID looks like name@bank"));

export const truckPartyRoleSchema = z.enum(["owner", "broker", "both"]);
export const truckPartyStatusSchema = z.enum(["active", "blacklisted"]);

export const truckPartyFields = z.object({
  role: truckPartyRoleSchema,
  name: text(200),
  mobile: optional(mobileSchema),
  altMobile: optional(mobileSchema),
  pan: optional(panSchema),
  gstin: optional(gstinSchema),
  address: optionalText(500),
  bankName: optionalText(100),
  accountHolder: optionalText(200),
  accountNo: optional(accountNoSchema),
  ifsc: optional(ifscSchema),
  upiId: optional(upiSchema),
  upiQrUrl: optionalText(500),
  bankProofUrl: optionalText(500),
  verified: z.boolean(),
  status: truckPartyStatusSchema,
  blacklistReason: optionalText(300),
  notes: optionalText(500),
});
export const truckPartyPatchSchema = truckPartyFields.partial();
export type TruckPartyInput = z.input<typeof truckPartyFields>;
export type TruckPartyValues = z.output<typeof truckPartyFields>;
export type TruckPartyPatch = z.input<typeof truckPartyPatchSchema>;

type RuleInput = {
  gstin?: string | null;
  pan?: string | null;
  status?: string;
  blacklistReason?: string | null;
  accountNo?: string | null;
  ifsc?: string | null;
};

/** Cross-field rules, checked on the full record after create / merge. */
export function truckPartyRuleErrors(p: RuleInput): RuleError[] {
  const errors: RuleError[] = [];
  if (p.gstin && p.pan && !panMatchesGstin(p.pan, p.gstin)) {
    errors.push({ path: "pan", message: "PAN doesn't match GSTIN characters 3–12" });
  }
  if (p.status === "blacklisted" && !p.blacklistReason) {
    errors.push({ path: "blacklistReason", message: "Give a reason to blacklist" });
  }
  if (p.accountNo && !p.ifsc) errors.push({ path: "ifsc", message: "IFSC is needed with an account number" });
  if (p.ifsc && !p.accountNo) errors.push({ path: "accountNo", message: "Account number is needed with an IFSC" });
  return errors;
}

export const tdsDeclarationFields = z.object({
  partyId: z.uuid(),
  fy: z.string().regex(/^\d{4}-\d{2}$/, "Financial year looks like 2025-26"),
  fileUrl: optionalText(500),
  vehiclesOwnedDeclared: optional(z.coerce.number("Enter a whole number, e.g. 5").int("Whole number").min(0)),
  receivedOn: optional(isoDate),
});
export type TdsDeclarationInput = z.input<typeof tdsDeclarationFields>;

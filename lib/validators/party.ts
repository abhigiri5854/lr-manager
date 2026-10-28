import { z } from "zod";
import {
  chargedAsSchema,
  gstinSchema,
  gstPayerSchema,
  lrPaymentModeSchema,
  mobileSchema,
  optional,
  optionalText,
  panMatchesGstin,
  panSchema,
  pincode,
  recordSourceSchema,
  stateCode,
  text,
  type RuleError,
} from "./common";

export const partyFields = z.object({
  name: text(200),
  place: optionalText(100),
  gstin: optional(gstinSchema),
  pan: optional(panSchema),
  phone: optional(mobileSchema),
  address: optionalText(500),
  stateCode: optional(stateCode),
  pincode: optional(pincode),
  logoUrl: optionalText(500),
  defaultFrom: optionalText(100),
  defaultPaymentMode: optional(lrPaymentModeSchema),
  defaultGstPayer: optional(gstPayerSchema),
  defaultChargedAs: optional(chargedAsSchema),
  source: recordSourceSchema.optional(),
});
export const partyPatchSchema = partyFields.partial();
export type PartyInput = z.input<typeof partyFields>;
export type PartyPatch = z.input<typeof partyPatchSchema>;

type PartyRuleInput = { gstin?: string | null; pan?: string | null; stateCode?: string | null };

/** Cross-field rules, checked on the full record after create / merge. */
export function partyRuleErrors(p: PartyRuleInput): RuleError[] {
  const errors: RuleError[] = [];
  if (p.gstin && p.pan && !panMatchesGstin(p.pan, p.gstin)) {
    errors.push({ path: "pan", message: "PAN doesn't match GSTIN characters 3–12" });
  }
  if (p.gstin && p.stateCode && p.gstin.slice(0, 2) !== p.stateCode) {
    errors.push({
      path: "stateCode",
      message: "State code doesn't match the GSTIN's first 2 digits",
    });
  }
  return errors;
}

import { z } from "zod";
import { isoDate, optionalText, paise, uuid, type RuleError } from "./common";

export const freightBillLineSchema = z.object({
  id: uuid.optional(),
  lrId: uuid,
  freightPaise: paise,
  detentionPaise: paise.optional(),
  otherPaise: paise.optional(),
  advancePaise: paise.optional(),
});

export const freightBillFields = z.object({
  billDate: isoDate,
  partyId: uuid,
  gstMode: z.enum(["reverse_charge", "forward_charge"]),
  /** Only used under forward charge. 500 = 5%, 1200 = 12%. */
  gstRateBp: z.number().int().min(0).max(2800).optional(),
  lines: z.array(freightBillLineSchema).min(1, "Tick at least one LR"),
});
export const freightBillPatchSchema = freightBillFields.partial();
export type FreightBillInput = z.input<typeof freightBillFields>;
export type FreightBillPatch = z.input<typeof freightBillPatchSchema>;

export const paymentFields = z.object({
  partyId: uuid,
  /** Empty or missing = on-account advance. */
  allocations: z.array(z.object({ freightBillId: uuid, amountPaise: paise.positive() })).optional(),
  amountPaise: paise,
  tdsPaise: paise.optional(),
  mode: z.enum(["neft_upi", "cheque", "cash"]),
  receivedOn: isoDate,
  reference: optionalText(100),
});
export type PaymentInput = z.input<typeof paymentFields>;

/** Allocations can't exceed what was received plus TDS. */
export function paymentRuleErrors(p: {
  amountPaise: number;
  tdsPaise: number;
  allocations: { amountPaise: number }[];
}): RuleError[] {
  const errors: RuleError[] = [];
  if (p.amountPaise + p.tdsPaise <= 0)
    errors.push({ path: "amountPaise", message: "Enter an amount" });
  const allocated = p.allocations.reduce((s, a) => s + a.amountPaise, 0);
  if (allocated > p.amountPaise + p.tdsPaise) {
    errors.push({ path: "allocations", message: "Allocated more than amount + TDS" });
  }
  return errors;
}

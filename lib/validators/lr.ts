import { z } from "zod";
import {
  chargedAsSchema,
  decimal,
  ewayBillNoSchema,
  gstPayerSchema,
  isoDate,
  isoDateTime,
  lrPaymentModeSchema,
  mobileSchema,
  optional,
  optionalText,
  paise,
  text,
  uuid,
  type RuleError,
} from "./common";

export const lrItemSchema = z.object({
  id: uuid.optional(),
  itemId: optional(uuid),
  description: text(200),
  packages: z.number().int().nonnegative(),
  actualWeight: optional(decimal),
  chargedWeight: optional(decimal),
  size: optionalText(50),
});

export const lrInvoiceSchema = z.object({
  id: uuid.optional(),
  invoiceNo: text(50),
  invoiceDate: optional(isoDate),
  valuePaise: optional(paise),
  ewayBillNo: optional(ewayBillNoSchema),
  ewayExpiresAt: optional(isoDateTime),
  taxInvoiceId: optional(uuid),
});

export const lrChargesSchema = z.object({
  freight: optional(paise),
  packing: optional(paise),
  cnCharge: optional(paise),
  loading: optional(paise),
  unloading: optional(paise),
  detention: optional(paise),
  other: optional(paise),
  gst: optional(paise),
  advance: optional(paise),
});

/** Everything is optional so a draft can be saved half-filled; booking checks what it needs. */
export const lrFields = z.object({
  lrDate: optional(isoDate),
  fromPlace: optionalText(100),
  toPlace: optionalText(100),
  risk: z.enum(["owner", "carrier"]).optional(),
  consignorId: optional(uuid),
  consigneeId: optional(uuid),
  billedToId: optional(uuid),
  gstPaidBy: optional(gstPayerSchema),
  paymentMode: optional(lrPaymentModeSchema),
  chargedAs: optional(chargedAsSchema),
  ratePaise: optional(paise),
  truckId: optional(uuid),
  driverMobile: optional(mobileSchema),
  lrInvoices: z.array(lrInvoiceSchema).optional(),
  items: z.array(lrItemSchema).optional(),
  charges: lrChargesSchema.optional(),
  remarks: optionalText(500),
});
export const lrPatchSchema = lrFields.partial();
export type LrInput = z.input<typeof lrFields>;
export type LrPatch = z.input<typeof lrPatchSchema>;

type LrBookingInput = {
  lrDate: string | null;
  fromPlace: string | null;
  toPlace: string | null;
  consignorId: string | null;
  consigneeId: string | null;
  paymentMode: string | null;
  items: { packages: number }[];
};

/** What must be filled before a draft LR can be booked. */
export function lrBookingErrors(lr: LrBookingInput): RuleError[] {
  const errors: RuleError[] = [];
  const need = (path: keyof LrBookingInput, label: string, ok: unknown) => {
    if (!ok) errors.push({ path, message: `${label} is required to book the LR` });
  };
  need("lrDate", "LR date", lr.lrDate);
  need("fromPlace", "From", lr.fromPlace);
  need("toPlace", "To", lr.toPlace);
  need("consignorId", "Consignor", lr.consignorId);
  need("consigneeId", "Consignee", lr.consigneeId);
  need("paymentMode", "Payment mode", lr.paymentMode);
  if (!lr.items.some((i) => i.packages > 0)) {
    errors.push({ path: "items", message: "Add at least one item with packages" });
  }
  return errors;
}

/** Cancelling an LR needs a reason (kept on the LR and in the audit log). */
export const lrCancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Say why the LR is being cancelled")
    .max(200, "Keep the reason under 200 characters"),
});
export type LrCancelInput = z.input<typeof lrCancelSchema>;

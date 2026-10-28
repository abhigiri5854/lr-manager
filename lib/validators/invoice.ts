import { z } from "zod";
import { isGstRateBp } from "@/lib/gst";
import {
  decimal,
  ewayBillNoSchema,
  isoDate,
  isoDateTime,
  mobileSchema,
  optional,
  optionalText,
  paise,
  stateCode,
  text,
  uuid,
} from "./common";

export const taxInvoiceLineSchema = z.object({
  id: uuid.optional(),
  itemId: optional(uuid),
  itemCode: optionalText(40),
  description: text(300),
  hsn: optional(z.string().regex(/^\d{4,8}$/, "HSN must be 4–8 digits")),
  uom: optionalText(10),
  qty: decimal,
  ratePaise: paise,
  discountPaise: paise.optional(),
  /** 1800 = 18% */
  gstRateBp: z
    .number()
    .int()
    .refine(isGstRateBp, "GST rate must be 0, 0.25, 3, 5, 12, 18, 28 or 40%"),
});

export const taxInvoiceFields = z.object({
  /** Own invoices: left empty, allocated on Finalise. Imported: the seller's number (required). */
  invoiceNo: optionalText(30),
  invoiceAt: isoDateTime,
  sellerPartyId: optional(uuid),
  billToId: uuid,
  shipToId: optional(uuid),
  /** Only used when the ship-to party has no state of its own (unregistered buyer). */
  placeOfSupplyStateCode: optional(stateCode),
  customerRef: optionalText(50),
  customerRefDate: optional(isoDate),
  soNo: optionalText(30),
  soDate: optional(isoDate),
  doNo: optionalText(30),
  sapRef: optionalText(30),
  transporterName: optionalText(100),
  truckId: optional(uuid),
  driverMobile: optional(mobileSchema),
  shipFrom: optionalText(100),
  incoterm: optionalText(100),
  lines: z.array(taxInvoiceLineSchema).min(1, "Add at least one item"),
  irn: optional(z.string().regex(/^[0-9a-f]{64}$/i, "IRN is 64 characters")),
  ewayBillNo: optional(ewayBillNoSchema),
  sourceFileUrl: optionalText(500),
  importBatchId: optional(uuid),
});
export const taxInvoicePatchSchema = taxInvoiceFields.partial();
export type TaxInvoiceInput = z.input<typeof taxInvoiceFields>;
export type TaxInvoicePatch = z.input<typeof taxInvoicePatchSchema>;

/** Number rule for tax invoices: max 16 characters, only A-Z, 0-9, "/" and "-". */
export const INVOICE_NO_MAX = 16;
export const INVOICE_NO_CHARS = /^[A-Z0-9/-]+$/;

/** Prefix leaves room for at least a 4-digit counter within the 16-character limit. */
export const taxInvoicePrefixSchema = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .pipe(
    z
      .string()
      .max(INVOICE_NO_MAX - 4, `Prefix can be at most ${INVOICE_NO_MAX - 4} characters`)
      .regex(/^[A-Z0-9/-]*$/, "Prefix can only use A-Z, 0-9, / and -"),
  );

/** "ACM/TI/", 7 → "ACM/TI/007"; null when the result breaks the 16-character rule. */
export function formatInvoiceNo(prefix: string, n: number): string | null {
  const no = `${prefix}${String(n).padStart(3, "0")}`;
  return no.length <= INVOICE_NO_MAX && INVOICE_NO_CHARS.test(no) ? no : null;
}

export const cancelReasonSchema = text(300);

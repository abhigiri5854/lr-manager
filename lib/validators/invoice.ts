import { z } from "zod";
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
  gstRateBp: z.number().int().min(0).max(2800),
});

export const taxInvoiceFields = z.object({
  invoiceNo: text(30),
  invoiceAt: isoDateTime,
  sellerPartyId: optional(uuid),
  billToId: uuid,
  shipToId: optional(uuid),
  placeOfSupplyStateCode: stateCode,
  customerRef: optionalText(50),
  customerRefDate: optional(isoDate),
  soNo: optionalText(30),
  soDate: optional(isoDate),
  doNo: optionalText(30),
  sapRef: optionalText(30),
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

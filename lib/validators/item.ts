import { z } from "zod";
import { isGstRateBp } from "@/lib/gst";
import { optional, paise, text } from "./common";

export const hsnSchema = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, "HSN must be 4–8 digits");

export const itemFields = z.object({
  code: optional(
    z
      .string()
      .trim()
      .min(1)
      .max(40)
      .transform((v) => v.toUpperCase()),
  ),
  name: text(300),
  hsn: optional(hsnSchema),
  uom: optional(
    z
      .string()
      .trim()
      .min(1)
      .max(10)
      .transform((v) => v.toUpperCase()),
  ),
  /** 1800 = 18% */
  gstRateBp: optional(
    z.number().int().refine(isGstRateBp, "GST rate must be 0, 0.25, 3, 5, 12, 18, 28 or 40%"),
  ),
  lastRatePaise: optional(paise),
});
export const itemPatchSchema = itemFields.partial();
export type ItemInput = z.input<typeof itemFields>;
export type ItemPatch = z.input<typeof itemPatchSchema>;

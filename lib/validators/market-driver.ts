import { z } from "zod";
import { isoDate, mobileSchema, optional, optionalText, text } from "./common";

const dlNoSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9/-]{8,20}$/, "Licence number is 8–20 letters / digits"));

// Market (hired) drivers: TIER1-MARKET-TRUCKS.md §5 `drivers`.
export const marketDriverFields = z.object({
  name: text(200),
  mobile: optional(mobileSchema),
  dlNo: optional(dlNoSchema),
  dlUpto: optional(isoDate),
  dlFileUrl: optionalText(500),
});
export const marketDriverPatchSchema = marketDriverFields.partial();
export type MarketDriverInput = z.input<typeof marketDriverFields>;
export type MarketDriverValues = z.output<typeof marketDriverFields>;
export type MarketDriverPatch = z.input<typeof marketDriverPatchSchema>;

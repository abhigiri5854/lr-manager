import { z } from "zod";
import { isValidFy } from "@/lib/fy";
import { optionalText, text } from "./common";

// Hire masters: vehicle types, charge types, pumps, branches, challan / payment number series
// (TIER1-MARKET-TRUCKS.md §5, §7).

const optionalInt = (min: number, max: number) =>
  z.number("Enter capacity in kg, e.g. 16000").int("Whole kg").min(min).max(max).nullable().optional();

export const vehicleTypeFields = z.object({
  name: text(100),
  capacityKg: optionalInt(1, 200_000),
  active: z.boolean(),
});
export const vehicleTypePatchSchema = vehicleTypeFields.partial();
export type VehicleTypeInput = z.input<typeof vehicleTypeFields>;
export type VehicleTypeValues = z.output<typeof vehicleTypeFields>;
export type VehicleTypePatch = z.input<typeof vehicleTypePatchSchema>;

const chargeCodeSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, "_").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9_]{2,30}$/, "Code is 2–30 letters, digits or _"));

export const chargeTypeFields = z.object({
  code: chargeCodeSchema,
  label: text(100),
  defaultDirection: z.enum(["add", "deduct"]),
  defaultBillParty: z.boolean(),
  stage: z.enum(["hire", "pod"]),
  active: z.boolean(),
});
export const chargeTypePatchSchema = chargeTypeFields.partial();
export type ChargeTypeInput = z.input<typeof chargeTypeFields>;
export type ChargeTypeValues = z.output<typeof chargeTypeFields>;
export type ChargeTypePatch = z.input<typeof chargeTypePatchSchema>;

export const pumpFields = z.object({
  name: text(100),
  location: optionalText(200),
  ledgerRef: optionalText(200),
});
export const pumpPatchSchema = pumpFields.partial();
export type PumpInput = z.input<typeof pumpFields>;
export type PumpValues = z.output<typeof pumpFields>;
export type PumpPatch = z.input<typeof pumpPatchSchema>;

export const branchFields = z.object({
  name: text(100),
  code: optionalText(20),
  address: optionalText(300),
});
export const branchPatchSchema = branchFields.partial();
export type BranchInput = z.input<typeof branchFields>;
export type BranchValues = z.output<typeof branchFields>;
export type BranchPatch = z.input<typeof branchPatchSchema>;

const fySchema = z
  .string()
  .trim()
  .regex(/^[0-9]{4}-[0-9]{2}$/, "Financial year looks like 2026-27")
  .refine(isValidFy, "Financial year must span consecutive years, e.g. 2026-27");

const seriesCounter = {
  prefix: z.string().trim().max(20, "Prefix is at most 20 characters"),
  nextNo: z.number("Enter the next number, e.g. 1").int("Next number is a whole number").min(1, "Next number starts at 1"),
  padding: z.number("Enter padding 0–12").int("Padding is 0–12").min(0, "Padding is 0–12").max(12, "Padding is 0–12"),
};

export const seriesFields = z.object({
  docType: z.enum(["challan", "truck_payment"]),
  branchId: z.string().uuid("Choose a branch"),
  fy: fySchema,
  ...seriesCounter,
});
export const seriesCounterSchema = z.object(seriesCounter);
export type SeriesInput = z.input<typeof seriesFields>;
export type SeriesValues = z.output<typeof seriesFields>;
export type SeriesKey = Pick<SeriesValues, "docType" | "branchId" | "fy">;
export type SeriesCounterInput = z.input<typeof seriesCounterSchema>;

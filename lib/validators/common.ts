import { z } from "zod";

// ---------- GSTIN ----------
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$/;
const PAN_SHAPE = /^[A-Z]{5}\d{4}[A-Z]$/;

/** Valid GST state / UT codes: 01–38, 97 (other territory), 99 (centre jurisdiction). */
export function isValidStateCode(code: string): boolean {
  const n = Number(code);
  return /^\d{2}$/.test(code) && ((n >= 1 && n <= 38) || n === 97 || n === 99);
}

/** Removes spaces and upper-cases: " 10aabca 7061k2zz " → "10AABCA7061K2ZZ". */
export function normaliseGstin(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** The check character (15th) for the first 14 characters of a GSTIN. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** Why a GSTIN is invalid, or null when it is valid. Expects a normalised value. */
export function gstinError(gstin: string): string | null {
  if (gstin.length !== 15) return `GSTIN has ${gstin.length} characters (needs 15)`;
  if (!GSTIN_SHAPE.test(gstin)) return "GSTIN format is wrong";
  if (!isValidStateCode(gstin.slice(0, 2)))
    return `GSTIN state code ${gstin.slice(0, 2)} is not valid`;
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) {
    return "GSTIN check digit doesn't match — look for a typo";
  }
  return null;
}

export function isValidGstin(value: string): boolean {
  return gstinError(normaliseGstin(value)) === null;
}

// ---------- PAN ----------
export function normalisePan(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function isValidPan(value: string): boolean {
  return PAN_SHAPE.test(normalisePan(value));
}

/** PAN must equal GSTIN characters 3–12. */
export function panMatchesGstin(pan: string, gstin: string): boolean {
  return normaliseGstin(gstin).slice(2, 12) === normalisePan(pan);
}

// ---------- vehicle ----------
const VEHICLE_STANDARD = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/; // BR01GN8331, DL1CAB1234
const VEHICLE_BH = /^\d{2}BH\d{4}[A-Z]{1,2}$/; // 22BH1234AB

/** "br 01 gn-8331" → "BR01GN8331" (the stored, unique form). */
export function normaliseVehicleNo(value: string): string {
  return value.replace(/[\s\-.]/g, "").toUpperCase();
}

export function isValidVehicleNo(value: string): boolean {
  const v = normaliseVehicleNo(value);
  return VEHICLE_STANDARD.test(v) || VEHICLE_BH.test(v);
}

// ---------- e-way bill ----------
export function normaliseEwayBillNo(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/** E-way bill numbers are 12 digits. */
export function isValidEwayBillNo(value: string): boolean {
  return /^\d{12}$/.test(normaliseEwayBillNo(value));
}

// ---------- mobile ----------
/** "+91 78700 15869" / "078700-15869" → "7870015869". Unrecognised input is returned digits-only. */
export function normaliseMobile(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

/** Indian mobile: 10 digits starting 6–9. */
export function isValidMobile(value: string): boolean {
  return /^[6-9]\d{9}$/.test(normaliseMobile(value));
}

// ---------- Zod building blocks ----------
function normalised(normalise: (v: string) => string, error: (v: string) => string | null) {
  return z.string().transform((raw, ctx) => {
    const value = normalise(raw);
    const message = error(value);
    if (message) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return value;
  });
}

export const gstinSchema = normalised(normaliseGstin, gstinError);
export const panSchema = normalised(normalisePan, (v) =>
  PAN_SHAPE.test(v) ? null : "PAN must look like ABCDE1234F",
);
export const vehicleNoSchema = normalised(normaliseVehicleNo, (v) =>
  isValidVehicleNo(v) ? null : "Vehicle number format looks wrong (e.g. BR01GN8331)",
);
export const ewayBillNoSchema = normalised(normaliseEwayBillNo, (v) =>
  /^\d{12}$/.test(v) ? null : "E-way bill number must be 12 digits",
);
export const mobileSchema = normalised(normaliseMobile, (v) =>
  /^[6-9]\d{9}$/.test(v) ? null : "Mobile number must be 10 digits starting with 6–9",
);

/**
 * Optional form value: "" or null → null; a missing key stays missing
 * (so the same schema works for create and for partial updates).
 */
export function optional<T extends z.ZodType>(schema: T) {
  return z
    .preprocess((v) => (v === "" ? null : v), schema.nullish())
    .transform((v): z.output<T> | null => v ?? null)
    .optional();
}

export const text = (max = 200) => z.string().trim().min(1, "Required").max(max);
export const optionalText = (max = 200) => optional(text(max));
export const uuid = z.uuid();
export const paise = z.number().int("Money must be whole paise").nonnegative();
export const decimal = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, "Enter a number like 564.000");
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Not a real date");
export const isoDateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "Not a valid date/time");
export const stateCode = z.string().refine(isValidStateCode, "Not a valid GST state code");
export const pincode = z.string().regex(/^[1-9]\d{5}$/, "PIN code must be 6 digits");

export const roleSchema = z.enum(["owner", "accountant", "booking_staff", "driver"]);
export const lrPaymentModeSchema = z.enum(["to_pay", "paid", "tbb"]);
export const gstPayerSchema = z.enum(["consignor", "consignee", "transporter"]);
export const chargedAsSchema = z.enum(["ftl", "per_kg", "per_pkg"]);
export const recordSourceSchema = z.enum(["manual", "lr", "invoice_scan", "excel_import"]);

/** A cross-field rule failure; path is the field name to highlight. */
export type RuleError = { path: string; message: string };

/** List query params shared by every list(); pageSize is capped at 50. */
export const listParamsSchema = z.object({
  search: z.string().trim().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
});

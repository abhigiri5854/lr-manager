// Turning one spreadsheet cell into the text Smart import shows and parses, and tidying a cell
// once we know which system field its column feeds: dates → dd-mm-yyyy, Indian amounts
// (1,84,902.58 / ₹ 7,000/-) → plain 184902.58, vehicle numbers → BR01GN8331. Anything that
// doesn't fit is left exactly as typed, so the row review can point at it.
import { dmyOf, serialToYmd, serialTextToIso } from "./excel-date";
import { parseSheetDate } from "./excel-rows";
import { normaliseGstin, isValidVehicleNo, normaliseVehicleNo } from "@/lib/validators/common";

/** The slice of a SheetJS cell this needs (so tests don't have to build workbooks). */
export type RawCell = { t?: string; v?: unknown; z?: string | number } | undefined;

/** 12 significant digits drops float noise (0.1 + 0.2) and never shows "1.2E+3". */
const plainNumber = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12)));

/**
 * @param isDateFormat whether a number format string is a date/time format (SheetJS SSF.is_date)
 * @param date1904 the workbook counts days from 1904
 */
export function cellText(
  cell: RawCell,
  isDateFormat: (fmt: string) => boolean,
  date1904 = false,
): string {
  if (!cell || cell.v === undefined || cell.v === null) return "";
  if (cell.t === "n" && typeof cell.v === "number") {
    // Formulas arrive here as their last calculated value: SheetJS keeps it in `v`.
    if (typeof cell.z === "string" && isDateFormat(cell.z)) {
      const ymd = serialToYmd(cell.v, date1904);
      if (ymd) return dmyOf(ymd);
    }
    return plainNumber(cell.v);
  }
  if (cell.t === "b" || cell.t === "e") return ""; // TRUE/FALSE and #REF! tell us nothing
  if (cell.v instanceof Date) {
    return dmyOf({
      y: cell.v.getUTCFullYear(),
      m: cell.v.getUTCMonth() + 1,
      d: cell.v.getUTCDate(),
    });
  }
  return String(cell.v).replace(/\s+/g, " ").trim();
}

const AMOUNT_FIELDS = new Set(["rate", "freight"]);
const NUMBER_FIELDS = new Set(["packages", "billing_weight", "actual_weight"]);

/** "₹ 1,84,902.58" or "Rs. 7,000/-" → "184902.58" / "7000"; null when it isn't clearly an amount. */
function plainAmount(text: string): string | null {
  const s = text
    .replace(/^(?:₹|rs\.?|inr)\s*/i, "")
    .replace(/\s*\/-$/, "")
    .replace(/[\s,]/g, "");
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

/** Tidies `text` for the field its column feeds; unchanged when it doesn't fit. */
export function tidyForField(field: string, text: string): string {
  if (!text) return text;
  if (field === "lr_date") {
    const serial = serialTextToIso(text);
    const iso = serial ?? parseSheetDate(text);
    if (typeof iso === "string") return `${iso.slice(8)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
    return text;
  }
  if (field === "vehicle_no") {
    const v = normaliseVehicleNo(text);
    return isValidVehicleNo(v) ? v : text;
  }
  if (field === "consignor_gstin" || field === "consignee_gstin") {
    const g = normaliseGstin(text);
    return g.length === 15 ? g : text;
  }
  if (AMOUNT_FIELDS.has(field) || NUMBER_FIELDS.has(field)) return plainAmount(text) ?? text;
  return text;
}

// Rule-based reader for the text layer of a digital tax-invoice PDF. Best effort: it fills what
// it can find with plain patterns and leaves the rest out. Nothing here is trusted on its own —
// finish-invoice.ts checks GSTIN checksums and reconciles item rows against the printed totals.
// Pure: no I/O, unit-testable.
import { gstinError, normaliseGstin, normaliseVehicleNo, isValidVehicleNo } from "@/lib/validators/common";
import type { Draft, DraftLine } from "./draft";

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][A-Z0-9]\b/g;
const AMOUNT_RE = /\d[\d,]*\.\d{1,2}\b/g;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "1,84,902.58" → 18490258 paise. */
export function amountToPaise(text: string): number | null {
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** dd-mm-yyyy, dd/mm/yyyy, dd.mm.yyyy or dd-Mon-yyyy → yyyy-mm-dd. */
export function textDateToIso(text: string): string | null {
  const m = text.match(/\b(\d{1,2})[-/. ]([A-Za-z]{3,9}|\d{1,2})[-/. ](\d{4}|\d{2})\b/);
  if (!m) return null;
  const month = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
  const day = Number(m[1]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const lastAmount = (line: string): number | null => {
  const all = line.match(AMOUNT_RE);
  return all ? amountToPaise(all[all.length - 1]) : null;
};

/** The amount on the first line that matches `label` (value at the end of the line, else the next line). */
function labelled(lines: string[], label: RegExp): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (!label.test(lines[i])) continue;
    const v = lastAmount(lines[i]) ?? (lines[i + 1] ? lastAmount(lines[i + 1]) : null);
    if (v !== null) return v;
  }
  return undefined;
}

function findInvoiceNo(text: string): string | undefined {
  const m = text.match(
    /(?:tax\s+)?invoice\s*(?:no\.?|number|#)\s*[:\-.]?\s*([A-Z0-9][A-Z0-9/\-]{2,24})/i,
  );
  // Needs a digit, so "Invoice Number Date" doesn't read "Date" as the number.
  return m && /\d/.test(m[1]) ? m[1].toUpperCase() : undefined;
}

function findInvoiceDate(text: string): string | undefined {
  const m = text.match(/(?:invoice\s*)?date(?:d)?\s*[:\-]?\s*([^\n]{0,24})/i);
  return (m && textDateToIso(m[1])) || undefined;
}

/** First valid-looking GSTIN is the seller; the first after a buyer label is the buyer. */
function findGstins(text: string): Pick<Draft, "sellerGstin" | "buyerGstin"> {
  const found: { gstin: string; at: number }[] = [];
  for (const m of text.matchAll(GSTIN_RE)) {
    const g = normaliseGstin(m[0]);
    if (gstinError(g) === null && !found.some((f) => f.gstin === g)) found.push({ gstin: g, at: m.index });
  }
  if (!found.length) return {};
  const seller = found[0];
  const label = text.search(/bill(?:ed)?\s*to|buyer|customer|consignee|ship(?:ped)?\s*to/i);
  const buyer =
    (label >= 0 ? found.find((f) => f.at > label && f !== seller) : undefined) ?? found[1];
  return { sellerGstin: seller.gstin, buyerGstin: buyer?.gstin };
}

function findVehicle(text: string): string | undefined {
  for (const m of text.matchAll(/\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}\b/g)) {
    const v = normaliseVehicleNo(m[0]);
    if (isValidVehicleNo(v)) return v;
  }
  return undefined;
}

const UOMS = "EA|NOS|NO|PCS|PC|KG|KGS|MT|LTR|LTRS|BAG|BAGS|BOX|SET|MTR|SQM|ROLL|UNT|UNIT";

/**
 * One item row: [sr no] description HSN qty [uom] rate … [gst %] … amount. Rows are found by
 * their HSN (4, 6 or 8 digits) followed by a quantity; descriptions that wrap onto a second
 * line are not joined, which is why item rows stay orange unless they add up to the printed totals.
 */
function findItemRows(lines: string[]): DraftLine[] {
  const rows: DraftLine[] = [];
  const re = new RegExp(
    `^(?:\\d{1,3}\\s+)?(.{3,}?)\\s+(\\d{8}|\\d{6}|\\d{4})\\s+(\\d+(?:\\.\\d+)?)\\s*(${UOMS})?\\s+(\\d[\\d,]*\\.\\d{1,2})\\b(.*)$`,
    "i",
  );
  for (const line of lines) {
    const m = line.trim().match(re);
    if (!m) continue;
    const [, description, hsn, qty, uom, rate, rest] = m;
    const ratePaise = amountToPaise(rate);
    if (ratePaise === null) continue;
    // "9%  9%" (SGST + CGST) adds up; "18%" (IGST or a single column) stands alone.
    const pcts = [...rest.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((p) => Number(p[1]));
    const total = pcts.length === 2 && pcts[0] === pcts[1] ? pcts[0] * 2 : pcts[0];
    rows.push({
      description: description.trim(),
      hsn,
      uom: uom ? uom.toUpperCase() : null,
      qty,
      ratePaise,
      gstRateBp: total !== undefined ? Math.round(total * 100) : null,
    });
  }
  return rows;
}

/** Text of a digital invoice → whatever the rules can find. */
export function parseInvoiceText(text: string): Draft {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const flat = lines.join("\n");
  const draft: Draft = { lines: findItemRows(lines) };

  const set = <K extends keyof Draft>(k: K, v: Draft[K] | undefined) => {
    if (v !== undefined && v !== null) draft[k] = v;
  };
  set("invoiceNo", findInvoiceNo(flat));
  set("invoiceDate", findInvoiceDate(flat));
  Object.entries(findGstins(flat)).forEach(([k, v]) => v && set(k as "sellerGstin", v));
  set("vehicleNo", findVehicle(flat));
  set("ewayBillNo", flat.match(/e-?\s?way[^\n\d]{0,30}(\d{12})\b/i)?.[1]);
  set("irn", flat.match(/\b[0-9a-f]{64}\b/i)?.[0].toLowerCase());
  set("taxablePaise", labelled(lines, /taxable\s*(?:value|amount|amt)/i));
  set("sgstPaise", labelled(lines, /\bsgst\b(?!.*%.*%)/i));
  set("cgstPaise", labelled(lines, /\bcgst\b(?!.*%.*%)/i));
  set("igstPaise", labelled(lines, /\bigst\b(?!.*%.*%)/i));
  set(
    "totalPaise",
    labelled(lines, /(?:grand\s*total|total\s*invoice\s*(?:value|amount)|invoice\s*total|net\s*(?:amount|payable))/i),
  );
  return draft;
}

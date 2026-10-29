// What the three readers (QR, PDF text, Gemini) each try to fill in, before it is turned into the
// ReadInvoice shape. Pure: merging and checking live in `finish-invoice.ts`.
import type { ReadSource } from "./types";

export type DraftLine = {
  description: string;
  hsn: string | null;
  uom: string | null;
  /** Numeric text, e.g. "10" or "2.5". */
  qty: string;
  ratePaise: number;
  /** 1800 = 18%; null when the document doesn't show it. */
  gstRateBp: number | null;
};

export type Draft = {
  invoiceNo?: string;
  /** yyyy-mm-dd */
  invoiceDate?: string;
  sellerGstin?: string;
  buyerGstin?: string;
  sellerName?: string;
  buyerName?: string;
  vehicleNo?: string;
  ewayBillNo?: string;
  irn?: string;
  qrPayload?: string;
  /** From the e-invoice QR: how many items and the main HSN. */
  itemCount?: number;
  mainHsn?: string;
  taxablePaise?: number;
  sgstPaise?: number;
  cgstPaise?: number;
  igstPaise?: number;
  totalPaise?: number;
  lines: DraftLine[];
};

export type DraftKey = keyof Omit<Draft, "lines"> | "lines";

/** Which reader supplied each field (first reader to supply it wins). */
export type DraftSources = Partial<Record<DraftKey, ReadSource>>;

/** Fills only what `base` doesn't have yet. Lines come from one reader as a block. */
export function mergeDraft(
  base: Draft,
  sources: DraftSources,
  extra: Draft,
  source: ReadSource,
): { draft: Draft; sources: DraftSources } {
  const draft: Draft = { ...base, lines: base.lines };
  const out: DraftSources = { ...sources };
  for (const key of Object.keys(extra) as DraftKey[]) {
    if (key === "lines") {
      if (!draft.lines.length && extra.lines.length) {
        draft.lines = extra.lines;
        out.lines = source;
      }
      continue;
    }
    if (draft[key] === undefined && extra[key] !== undefined) {
      (draft as Record<string, unknown>)[key] = extra[key];
      out[key] = source;
    }
  }
  return { draft, sources: out };
}

/**
 * What a tax invoice needs before we stop looking (and skip the paid reader): the number, date,
 * both GSTINs, a total, and at least one line where every line has an HSN.
 */
export function missingFields(d: Draft): string[] {
  const missing: string[] = [];
  if (!d.invoiceNo) missing.push("invoiceNo");
  if (!d.invoiceDate) missing.push("invoiceDate");
  if (!d.sellerGstin) missing.push("sellerGstin");
  if (!d.buyerGstin) missing.push("buyerGstin");
  if (d.totalPaise === undefined) missing.push("totalPaise");
  if (!d.lines.length) missing.push("lines");
  else if (d.lines.some((l) => !l.hsn)) missing.push("lines.hsn");
  return missing;
}

// Seller memory: what the user changed after an AI read, kept per company + seller GSTIN and
// replayed on the next import from that seller. Pure rules; storage is in lib/data/import-store.ts.
import type { ImportCorrection, ReadInvoice } from "./types";

export type CorrectionRow = Pick<ImportCorrection, "field" | "wrong" | "correct">;

/** Fields worth remembering: the invoice number and the text of each item row. */
const LINE_FIELDS = ["description", "hsn", "uom", "gstRateBp"] as const;

/** The saved invoice, as far as corrections go (a subset of TaxInvoiceInput). */
export type SavedForCorrections = {
  invoiceNo?: string | null;
  lines: { description: string; hsn?: string | null; uom?: string | null; gstRateBp: number }[];
};

const clean = (v: string | number | null | undefined) => String(v ?? "").trim();

/**
 * Values the reader gave that the user then changed. Empty → filled is not a correction (nothing
 * was wrong to match later), and item rows are compared only when the row count is unchanged.
 */
export function diffCorrections(read: ReadInvoice, saved: SavedForCorrections): CorrectionRow[] {
  const out: CorrectionRow[] = [];
  const add = (field: string, wrong: string, correct: string) => {
    if (wrong && correct && wrong !== correct) out.push({ field, wrong, correct });
  };
  add("invoiceNo", clean(read.invoiceNo), clean(saved.invoiceNo));
  if (read.lines.length === saved.lines.length) {
    read.lines.forEach((r, i) => {
      const s = saved.lines[i];
      for (const f of LINE_FIELDS) add(f, clean(r[f]), clean(s[f]));
    });
  }
  return out;
}

/** Looks up a remembered correction for (field, wrong value); the caller marks the field "check". */
export type CorrectionLookup = (field: string, wrong: string) => string | null;

export function lookupFrom(rows: ImportCorrection[]): CorrectionLookup {
  return (field, wrong) => {
    const hits = rows.filter((r) => r.field === field && r.wrong === wrong);
    if (!hits.length) return null;
    return hits.reduce((a, b) => (b.count > a.count ? b : a)).correct;
  };
}

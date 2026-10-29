// Maps the headers of a sheet to the system fields (lib/import/fields.ts) without any AI:
//   1. saved mappings (the company's own, by header text) — "sure"
//   2. name similarity against a list of usual header names — "sure" when close, "confirm" when loose
// Headers left over are for the optional Gemini step (readers/gemini-columns.ts). Pure.
import { SKIP_FIELD, isFieldKey } from "./fields";
import type { ColumnConfidence } from "./types";

/** Usual header names per field. Compared after lower-casing and dropping punctuation. */
const ALIASES: Record<string, string[]> = {
  lr_no: ["lr no", "lr number", "lr", "lr #", "l r no", "gr no", "gr number", "lr id", "consignment no", "consignment note no", "cn no", "bilty no", "builty no", "docket no"],
  lr_date: ["lr date", "date", "lr dt", "booking date", "gr date", "bilty date", "consignment date", "dispatch date", "loading date"],
  from_place: ["from", "from place", "from city", "origin", "source", "loading point", "booking from", "dispatch from", "from station", "from location"],
  to_place: ["to", "to place", "to city", "destination", "dest", "delivery point", "unloading point", "to station", "to location", "delivery at"],
  consignor_name: ["consignor", "consignor name", "sender", "sender name", "shipper", "shipper name"],
  consignor_gstin: ["consignor gstin", "consignor gst no", "consignor gst", "sender gstin", "shipper gstin"],
  consignee_name: ["consignee", "consignee name", "receiver", "receiver name"],
  consignee_gstin: ["consignee gstin", "consignee gst no", "consignee gst", "receiver gstin"],
  invoice_no: ["invoice no", "invoice number", "invoice", "inv no", "inv number", "invoice #", "tax invoice no", "bill no"],
  vehicle_no: ["vehicle no", "vehicle number", "vehicle", "truck no", "truck number", "truck", "veh no", "lorry no", "gadi no", "vehicle reg no", "registration no"],
  driver_mobile: ["driver mobile", "driver mobile no", "driver phone", "driver contact", "driver no", "driver number", "driver mob"],
  packages: ["packages", "pkgs", "no of packages", "no of pkgs", "package", "quantity", "qty", "nos", "boxes", "cartons", "pcs", "units"],
  goods: ["goods", "goods description", "description of goods", "description", "material", "commodity", "product", "particulars", "contents"],
  billing_weight: ["billing weight", "billing wt", "charged weight", "charged wt", "chargeable weight", "charge weight", "bill weight", "bill wt", "freight weight"],
  actual_weight: ["actual weight", "actual wt", "act weight", "act wt", "gross weight", "gross wt"],
  rate: ["rate", "freight rate", "rate per kg", "rate kg", "rate per qtl", "rate per unit", "rate per ton"],
  freight: ["freight", "freight amount", "freight amt", "total freight", "basic freight", "lorry hire", "hire", "amount"],
  remarks: ["remarks", "remark", "note", "notes", "comments", "narration"],
};

/** Headers that don't say which weight they mean: guessed as billing weight, but the user checks. */
const AMBIGUOUS: Record<string, string> = {
  weight: "billing_weight",
  wt: "billing_weight",
  "weight kg": "billing_weight",
  "wt kg": "billing_weight",
  "total weight": "billing_weight",
};

/** At or above this a name match is "sure"; below it (down to CONFIRM) the user is asked. */
const SURE = 0.8;
const CONFIRM = 0.7;

/** "Consignor GSTIN No." → "consignor gstin no" */
export const normaliseHeader = (h: string): string =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const compact = (s: string) => s.replace(/ /g, "");

/** Edit distance ≤ 1 (a typo) for words of 5+ letters; shorter words must match exactly. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const rest = (s: string, from: number) => s.slice(from);
  return (
    rest(a, i + 1) === rest(b, i + 1) || // one letter different
    rest(a, i + 1) === rest(b, i) || // one extra in a
    rest(a, i) === rest(b, i + 1) // one extra in b
  );
}

/** 0..1: how well header `a` says the same as name `b` (both already normalised). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b || compact(a) === compact(b)) return 1;
  const ta = a.split(" ");
  const tb = b.split(" ");
  const left = [...tb];
  let hit = 0;
  for (const w of ta) {
    const at = left.findIndex((x) => sameWord(w, x));
    if (at >= 0) {
      hit++;
      left.splice(at, 1);
    }
  }
  return (2 * hit) / (ta.length + tb.length);
}

type Candidate = { field: string; score: number };

/** Every field the header could be, best first. */
export function candidatesFor(header: string): Candidate[] {
  // "Remarks 2" is a second remarks column, not a different thing.
  const h = normaliseHeader(header).replace(/ \d+$/, "");
  const out: Candidate[] = [];
  for (const [field, names] of Object.entries(ALIASES)) {
    const score = Math.max(...names.map((n) => similarity(h, n)));
    if (score >= CONFIRM) out.push({ field, score });
  }
  const loose = AMBIGUOUS[h];
  if (loose && !out.some((c) => c.field === loose && c.score >= SURE)) {
    // Just under "sure", so it is asked about.
    out.push({ field: loose, score: CONFIRM });
  }
  return out.sort((x, y) => y.score - x.score);
}

/** True when this header is one a booking sheet would normally have (used to find the header row). */
export const looksLikeKnownHeader = (header: string): boolean => candidatesFor(header).length > 0;

export type ColumnGuess = {
  header: string;
  field: string;
  confidence: ColumnConfidence;
  /** Where the guess came from. "none" = nothing matched (the Gemini step may still help). */
  via: "saved" | "name" | "none";
};

/**
 * @param headers   the sheet's headers, in order (unique)
 * @param saved     the company's saved mappings, header → field; for a header named in several,
 *                  the mapping that covers most of this sheet wins
 */
export function guessColumns(
  headers: string[],
  saved: Record<string, string>[] = [],
): ColumnGuess[] {
  const guesses = new Map<string, ColumnGuess>();
  const used = new Set<string>();

  // 1. saved mappings
  const savedByHeader = new Map<string, string>();
  const known = new Set(headers.map(normaliseHeader));
  const overlap = (m: Record<string, string>) =>
    Object.keys(m).filter((h) => known.has(normaliseHeader(h))).length;
  for (const m of [...saved].sort((x, y) => overlap(y) - overlap(x))) {
    for (const [h, field] of Object.entries(m)) {
      const key = normaliseHeader(h);
      if (!savedByHeader.has(key) && (field === SKIP_FIELD || isFieldKey(field))) {
        savedByHeader.set(key, field);
      }
    }
  }
  for (const header of headers) {
    const field = savedByHeader.get(normaliseHeader(header));
    if (field === undefined) continue;
    guesses.set(header, { header, field, confidence: "sure", via: "saved" });
    if (field !== SKIP_FIELD) used.add(field);
  }

  // 2. name similarity: best pairs first, so "Consignor GSTIN" goes to the GSTIN field and not the name
  const pairs = headers
    .filter((h) => !guesses.has(h))
    .flatMap((header) => candidatesFor(header).map((c) => ({ header, ...c })))
    .sort((a, b) => b.score - a.score);
  for (const p of pairs) {
    if (guesses.has(p.header) || used.has(p.field)) continue;
    guesses.set(p.header, {
      header: p.header,
      field: p.field,
      confidence: p.score >= SURE ? "sure" : "confirm",
      via: "name",
    });
    used.add(p.field);
  }

  return headers.map(
    (header) =>
      guesses.get(header) ?? { header, field: SKIP_FIELD, confidence: "sure", via: "none" },
  );
}

/** Fields no column has been mapped to yet (what Gemini may still be asked to place). */
export const freeFields = (guesses: ColumnGuess[]): string[] => {
  const taken = new Set(guesses.map((g) => g.field));
  return Object.keys(ALIASES).filter((f) => !taken.has(f));
};

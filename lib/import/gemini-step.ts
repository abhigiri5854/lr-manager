// The Gemini step of an invoice read: ask the cheap model first; if what it returned fails our own
// checks (a GSTIN that fails its checksum, item rows that don't add up to the printed totals), ask
// once more with the stronger model. Never more than two reads. The model call is passed in, so
// this is plain logic.
import { mergeDraft, type Draft, type DraftSources } from "./draft";
import { draftProblems } from "./finish-invoice";
import { GEMINI_FALLBACK_MODEL, GEMINI_MODEL } from "./readers/gemini-models";

export type GeminiStep = {
  draft: Draft;
  sources: DraftSources;
  /** Gemini filled at least one field. */
  used: boolean;
  /** The stronger model was asked as well. */
  retried: boolean;
};

const fromGemini = (sources: DraftSources, keys: (keyof DraftSources)[]) =>
  keys.some((k) => sources[k] === "gemini");

/** A problem the second model could fix: it sits in a field Gemini supplied (not the QR's or the PDF's). */
function fixable(problems: string[], sources: DraftSources): boolean {
  return problems.some((p) =>
    p === "totals"
      ? fromGemini(sources, ["lines", "totalPaise", "taxablePaise"])
      : fromGemini(sources, [p as keyof DraftSources]),
  );
}

/**
 * @param base    what the QR and the PDF text already found
 * @param read    one Gemini read with the named model; null when it gave no usable answer
 */
export async function readWithRetry(
  base: Draft,
  sources: DraftSources,
  read: (model: string) => Promise<Draft | null>,
): Promise<GeminiStep> {
  const none: GeminiStep = { draft: base, sources, used: false, retried: false };
  const first = await read(GEMINI_MODEL);
  if (!first) return none;
  const a = mergeDraft(base, sources, first, "gemini");
  const aProblems = draftProblems(a.draft);
  const step = (m: typeof a, retried: boolean): GeminiStep => ({
    ...m,
    used: Object.values(m.sources).includes("gemini"),
    retried,
  });
  if (!aProblems.length || !fixable(aProblems, a.sources)) return step(a, false);

  console.info("[import] gemini result failed validation, retrying", {
    problems: aProblems,
    model: GEMINI_FALLBACK_MODEL,
  });
  const second = await read(GEMINI_FALLBACK_MODEL);
  if (!second) return step(a, true);
  const b = mergeDraft(base, sources, second, "gemini");
  // The stronger model wins unless it did worse.
  return step(draftProblems(b.draft).length <= aProblems.length ? b : a, true);
}

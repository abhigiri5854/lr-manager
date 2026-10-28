import type { LrView } from "@/lib/types";

const dash = (v: string | null) => v || "—";

/**
 * "Consignor → Consignee" (wraps to at most 2 lines), then a small "billed: X" line
 * when someone else pays. Full text on hover. Use in a DataTable column with
 * `wrap` + `selfClamped`.
 */
export function LrParties({ lr }: { lr: LrView }) {
  const main = `${dash(lr.consignorName)} → ${dash(lr.consigneeName)}`;
  const billed = lr.billedToName && lr.billedToId !== lr.consigneeId ? lr.billedToName : null;
  return (
    <span className="block" title={billed ? `${main} · billed: ${billed}` : main}>
      <span className="line-clamp-2">{main}</span>
      {billed && <span className="line-clamp-1 text-xs text-muted">billed: {billed}</span>}
    </span>
  );
}

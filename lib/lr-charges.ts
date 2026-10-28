import { gstApplies } from "@/lib/lr-form";
import type { GstPayer, LrCharges, Paise } from "@/lib/types";

const LABELS: [keyof Omit<LrCharges, "advance">, string][] = [
  ["freight", "Freight"],
  ["packing", "Packing"],
  ["cnCharge", "C.N. charge"],
  ["loading", "Loading"],
  ["unloading", "Unloading"],
  ["detention", "Detention"],
  ["other", "Other"],
  ["gst", "GST"],
];

export type ChargeBreakdown = {
  /** Charges that were entered, in form order. */
  lines: { key: string; label: string; paise: Paise }[];
  totalPaise: Paise;
  advancePaise: Paise;
  balancePaise: Paise;
  /** Nothing entered at all (not even an advance). */
  empty: boolean;
};

/** What an LR charges, its total and the balance after advance (GST counts only if the transporter pays it). */
export function lrChargeBreakdown(charges: LrCharges, gstPaidBy: GstPayer | null): ChargeBreakdown {
  const lines = LABELS.filter(
    ([key]) =>
      charges[key] !== null && (key !== "gst" || gstApplies({ gstPaidBy: gstPaidBy ?? "" })),
  ).map(([key, label]) => ({ key, label, paise: charges[key]! }));
  const totalPaise = lines.reduce((sum, l) => sum + l.paise, 0);
  const advancePaise = charges.advance ?? 0;
  return {
    lines,
    totalPaise,
    advancePaise,
    balancePaise: totalPaise - advancePaise,
    empty: lines.length === 0 && charges.advance === null,
  };
}

import type { ChargedAs, LrPaymentMode } from "@/lib/types";

/** Display names for stored codes. */
export const chargedAsLabel: Record<ChargedAs, string> = {
  ftl: "FTL",
  per_kg: "Per kg",
  per_pkg: "Per package",
};

export const paymentModeLabel: Record<LrPaymentMode, string> = {
  tbb: "TBB",
  to_pay: "To pay",
  paid: "Paid",
};

/** ["a", "b", "c"] → "a, b and c" */
export function joinAnd(parts: string[]): string {
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

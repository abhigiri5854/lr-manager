import { daysBetween } from "@/lib/fy";
import type { IsoDate, Paise } from "@/lib/types";

/** Company POD rules; null = the company hasn't set them, so nothing is due or charged. */
export type PodRules = { podDays: number | null; podPenaltyPerDay: Paise | null };

/** Last day to hand in the signed copy: delivery date + the company's POD days. */
export function podDueDate(deliveredOn: IsoDate, podDays: number | null): IsoDate | null {
  if (podDays == null || !/^\d{4}-\d{2}-\d{2}$/.test(deliveredOn)) return null;
  const d = new Date(`${deliveredOn}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + podDays);
  return d.toISOString().slice(0, 10);
}

/** Days past the due date as of `asOf` (0 when on time or no rule). */
export function podLateDays(deliveredOn: IsoDate, asOf: IsoDate, podDays: number | null): number {
  return podDays == null ? 0 : Math.max(0, daysBetween(deliveredOn, asOf) - podDays);
}

/** Late days × per-day penalty; 0 when the company has no penalty rule. */
export function podPenaltyPaise(deliveredOn: IsoDate, asOf: IsoDate, rules: PodRules): Paise {
  return podLateDays(deliveredOn, asOf, rules.podDays) * (rules.podPenaltyPerDay ?? 0);
}

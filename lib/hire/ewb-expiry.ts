// E-way bill validity without the NIC API (TIER1-MARKET-TRUCKS.md D12): validity is one day per
// `kmPerDay` km or part of it (minimum 1 day), counted from the day of generation, and ends at
// midnight (24:00 India time) of the last day. Pure — no DB, settings passed in.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type EwbExpirySource = "computed" | "entered";
export type EwbBucket = "expired" | "under6h" | "under24h" | "later";

/** India calendar date (y, m0, d) of an instant, or of a yyyy-mm-dd string as written. */
function istDate(generated: string): { y: number; m: number; d: number } {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(generated);
  if (plain) return { y: Number(plain[1]), m: Number(plain[2]) - 1, d: Number(plain[3]) };
  const t = new Date(generated).getTime();
  if (Number.isNaN(t)) throw new Error("Invalid e-way bill generated date");
  const s = new Date(t + IST_OFFSET_MS);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate() };
}

/** Validity days for a distance: 1 per `kmPerDay` km or part, at least 1. */
export function ewbValidityDays(distanceKm: number, kmPerDay: number): number {
  if (!(kmPerDay > 0)) throw new Error("kmPerDay must be positive");
  const km = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  return Math.max(1, Math.ceil(km / kmPerDay));
}

/**
 * When the bill stops being valid, as an ISO instant: midnight (India) at the end of
 * generated day + validity days. `generatedOn` is yyyy-mm-dd or a timestamp (its India date is used).
 */
export function computeEwbExpiry(input: {
  generatedOn: string;
  distanceKm: number;
  kmPerDay: number;
}): { days: number; validUpto: string } {
  const days = ewbValidityDays(input.distanceKm, input.kmPerDay);
  const { y, m, d } = istDate(input.generatedOn);
  // 00:00 India of the day after the last valid day.
  const end = Date.UTC(y, m, d + days + 1, 0, 0, 0) - IST_OFFSET_MS;
  return { days, validUpto: new Date(end).toISOString() };
}

/**
 * The expiry to show for an LR's bill: the one typed in when there is one ("entered"), else computed
 * from the generated date + distance ("computed"). Null when there is no e-way no., or nothing to
 * compute from.
 */
export function resolveEwbExpiry(input: {
  ewbNo: string | null | undefined;
  enteredUpto: string | null | undefined;
  generatedOn: string | null | undefined;
  distanceKm: number | null | undefined;
  kmPerDay: number;
}): { validUpto: string; source: EwbExpirySource } | null {
  if (!input.ewbNo) return null;
  if (input.enteredUpto) return { validUpto: input.enteredUpto, source: "entered" };
  if (!input.generatedOn || input.distanceKm === null || input.distanceKm === undefined) return null;
  const { validUpto } = computeEwbExpiry({
    generatedOn: input.generatedOn,
    distanceKm: input.distanceKm,
    kmPerDay: input.kmPerDay,
  });
  return { validUpto, source: "computed" };
}

/** Milliseconds left (negative once expired) and a short label such as "5 h 20 m" or "2 d 3 h". */
export function ewbTimeLeft(validUpto: string, now: Date): { ms: number; expired: boolean; label: string } {
  const ms = new Date(validUpto).getTime() - now.getTime();
  const abs = Math.abs(ms);
  const totalMin = Math.floor(abs / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const mn = totalMin % 60;
  const text = d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${mn} m` : `${mn} m`;
  return { ms, expired: ms <= 0, label: ms <= 0 ? `expired ${text} ago` : text };
}

export function ewbBucket(validUpto: string, now: Date): EwbBucket {
  const ms = new Date(validUpto).getTime() - now.getTime();
  if (ms <= 0) return "expired";
  if (ms < 6 * HOUR_MS) return "under6h";
  if (ms < 24 * HOUR_MS) return "under24h";
  return "later";
}

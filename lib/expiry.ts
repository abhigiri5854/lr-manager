import type { IsoDate } from "@/lib/types";

/** Documents are flagged this many days before they lapse. */
export const EXPIRY_WARN_DAYS = 15;

const DAY_MS = 86_400_000;

export type ExpiryStatus =
  { state: "unset" } | { state: "ok" | "soon" | "expired"; daysLeft: number };

/** Days left on a document that lapses on `expiresOn` (inclusive); negative once it has lapsed. */
export function daysUntil(expiresOn: IsoDate, today: IsoDate): number {
  return Math.round(
    (Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS,
  );
}

/** "unset" with no date, "expired" after it, "soon" within 15 days of it, else "ok". */
export function expiryStatus(expiresOn: IsoDate | null, today: IsoDate): ExpiryStatus {
  if (!expiresOn) return { state: "unset" };
  const daysLeft = daysUntil(expiresOn, today);
  if (daysLeft < 0) return { state: "expired", daysLeft };
  return { state: daysLeft <= EXPIRY_WARN_DAYS ? "soon" : "ok", daysLeft };
}

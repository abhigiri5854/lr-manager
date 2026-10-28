/** Indian financial year (April–March) of an ISO date: "2026-10-14" → "2026-27". */
export function financialYear(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Whole days from a to b (UTC dates), e.g. daysBetween("2026-10-14", "2026-10-28") = 14. */
export function daysBetween(a: string, b: string): number {
  const day = (iso: string) => Math.floor(new Date(iso).getTime() / 86_400_000);
  return day(b) - day(a);
}

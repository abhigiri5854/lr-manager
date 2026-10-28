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

/** Today's date in India as yyyy-mm-dd (an LR booked at 1 am IST is dated today, not yesterday). */
export function todayInIndia(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);
}

// Excel stores dates as day counts ("serial numbers"). Pure helpers shared by the sheet reader and
// the row review, so a date column that came through as a plain number still reads as a date.

/** Serial numbers between 1954 and 2119 — anything else in a date column is not a serial. */
const MIN_SERIAL = 20000;
const MAX_SERIAL = 80000;

/** 46310 → { y: 2026, m: 10, d: 15 }; null when it isn't a plausible date serial. */
export function serialToYmd(
  serial: number,
  date1904 = false,
): { y: number; m: number; d: number } | null {
  if (!Number.isFinite(serial)) return null;
  const days = Math.floor(serial) + (date1904 ? 1462 : 0);
  if (days < MIN_SERIAL || days > MAX_SERIAL) return null;
  // Day 25569 is 1970-01-01 in the 1900 system (which counts a leap day that never was).
  const d = new Date(Math.round((days - 25569) * 86400000));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** "46310" or "46310.5" → "2026-10-15"; null when the text is not a date serial. */
export function serialTextToIso(text: string): string | null {
  if (!/^\d{5}(\.\d+)?$/.test(text)) return null;
  const ymd = serialToYmd(Number(text));
  return ymd ? isoOf(ymd) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = ({ y, m, d }: { y: number; m: number; d: number }) =>
  `${y}-${pad(m)}-${pad(d)}`;
export const dmyOf = ({ y, m, d }: { y: number; m: number; d: number }) =>
  `${pad(d)}-${pad(m)}-${y}`;

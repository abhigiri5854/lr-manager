// Parsing and formatting for the DateField / DateTimeField controls. Pure functions, no
// locale lookups: dates are always typed and shown as dd-mm-yyyy and stored as yyyy-mm-dd.
import type { IsoDate } from "@/lib/types";

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

export type DateParse = { ok: true; iso: IsoDate } | { ok: false; error: string };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function isRealDate(year: number, month: number, day: number): boolean {
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * "28-10-2026", "28/10/2026", "28.10.2026" or "28102026" → "2026-10-28". Anything else, or a
 * day that doesn't exist ("31-02-2026"), is an error with a message for the field.
 */
export function parseDisplayDate(text: string): DateParse {
  const t = text.trim();
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (!m) return { ok: false, error: "Use dd-mm-yyyy" };
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isRealDate(year, month, day)) return { ok: false, error: "Not a real date" };
  return { ok: true, iso: `${pad(year, 4)}-${pad(month)}-${pad(day)}` };
}

/** "2026-10-28" → "28-10-2026". Anything that isn't an ISO date gives "". */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/**
 * What the text box should show after the user typed or pasted `raw`. Adds the "-" after the
 * day and the month, keeps only digits and separators, pads "1/2/2026" to "01-02-2026", and
 * turns a pasted yyyy-mm-dd into dd-mm-yyyy. `prev` is the text before the edit, so that
 * deleting back over a "-" doesn't put it straight back.
 */
export function formatDateTyping(raw: string, prev = ""): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;

  if (/[-/.]/.test(raw)) {
    const parts = raw
      .split(/[-/.]/)
      .map((p) => p.replace(/\D/g, ""))
      .slice(0, 3);
    const [d = "", mo, y] = parts;
    const out = [d.slice(0, 2).padStart(parts.length > 1 ? 2 : 0, "0")];
    if (mo !== undefined) out.push(mo.slice(0, 2).padStart(parts.length > 2 ? 2 : 0, "0"));
    if (y !== undefined) out.push(y.slice(0, 4));
    // "28-10" typed over the first dash still gets its second one (not when deleting).
    if (y === undefined && mo?.length === 2 && raw.length >= prev.length) out.push("");
    return out.join("-");
  }

  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const out = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
    .filter(Boolean)
    .join("-");
  const deleting = raw.length < prev.length;
  return !deleting && (digits.length === 2 || digits.length === 4) ? `${out}-` : out;
}

// ---------- time (e-way expiry) ----------
/** "14:30" or "9:05" → "14:30"; hours 00–23, minutes 00–59. */
export function parseTime(text: string): { ok: true; time: string } | { ok: false; error: string } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return { ok: false, error: "Use hh:mm (24-hour)" };
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 23 || min > 59) return { ok: false, error: "Not a real time" };
  return { ok: true, time: `${pad(h)}:${pad(min)}` };
}

/** Adds the ":" while typing: "1430" → "14:30". */
export function formatTimeTyping(raw: string, prev = ""): string {
  if (raw.includes(":")) {
    const [h = "", mi = ""] = raw.split(":");
    return `${h.replace(/\D/g, "").slice(0, 2).padStart(2, "0")}:${mi.replace(/\D/g, "").slice(0, 2)}`;
  }
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  const out = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
  return raw.length >= prev.length && digits.length === 2 ? `${out}:` : out;
}

// ---------- calendar maths on ISO dates (UTC, so time zones never shift a day) ----------
const toUtc = (iso: IsoDate) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUtc = (d: Date): IsoDate =>
  `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function addDays(iso: IsoDate, n: number): IsoDate {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** Same day-of-month n months on, or the month's last day when it's shorter. */
export function addMonths(iso: IsoDate, n: number): IsoDate {
  const d = toUtc(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(Math.min(day, daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1)));
  return fromUtc(d);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(iso: IsoDate): number {
  return (toUtc(iso).getUTCDay() + 6) % 7;
}

export function clampDate(iso: IsoDate, min?: IsoDate, max?: IsoDate): IsoDate {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Weeks (Monday first) of the month containing `iso`; null pads the days outside it. */
export function monthWeeks(iso: IsoDate): (IsoDate | null)[][] {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const first = `${pad(y, 4)}-${pad(m)}-01`;
  const cells: (IsoDate | null)[] = Array(weekdayIndex(first)).fill(null);
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(`${pad(y, 4)}-${pad(m)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

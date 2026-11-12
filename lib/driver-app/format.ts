// Display helpers for the driver app (dd-mm-yyyy, India time).
const TZ = "Asia/Kolkata";

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** dd-mm-yyyy hh:mm */
export function formatDateTime(iso: string): string {
  const parts = Object.fromEntries(dateTimeFmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}`;
}

/** dd-mm-yyyy from a yyyy-mm-dd date or a full ISO timestamp. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}

/** Today in India as yyyy-mm-dd. */
export function todayIso(): string {
  return dayFmt.format(new Date());
}

/** "Open in Maps" link for an address. */
export function mapsUrl(...parts: Array<string | null | undefined>): string | null {
  const q = parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

/** "1d 4h" / "5h 12m" / "42m" */
export function formatLeft(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

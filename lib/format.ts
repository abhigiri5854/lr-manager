const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 18490258 → "1,84,902.58" */
export function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

/** "2026-10-14" or a full ISO timestamp → "14-10-2026" (UTC date). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

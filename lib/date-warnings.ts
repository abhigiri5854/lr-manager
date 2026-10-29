// Non-blocking date checks. Any real date can be saved (past or future, on drafts and on
// finalised documents); these only produce the amber note shown under a date field.
import { addMonths, isoToDisplay } from "@/lib/date-input";
import { financialYear } from "@/lib/fy";

export type DateWarningOptions = {
  /** Today in India, yyyy-mm-dd. */
  today: string;
  /** The date shouldn't be earlier than this one, e.g. delivery vs the LR date. */
  notBefore?: { date: string | null | undefined; label: string };
};

/**
 * Amber note for an event date (LR date, invoice date, delivery…): more than a year away from
 * today, in the future, or before a date it should follow. Null when nothing looks odd.
 */
export function dateWarning(
  iso: string | null | undefined,
  { today, notBefore }: DateWarningOptions,
): string | null {
  if (!iso) return null;
  const notes: string[] = [];
  if (iso > addMonths(today, 12)) notes.push("More than a year in the future — check the year");
  else if (iso > today) notes.push("This date is in the future");
  else if (iso < addMonths(today, -12)) notes.push("More than a year ago — check the year");
  if (notBefore?.date && iso < notBefore.date) {
    notes.push(`Before the ${notBefore.label} (${isoToDisplay(notBefore.date)})`);
  }
  return notes.length ? notes.join(" · ") : null;
}

/**
 * A finalised invoice / bill keeps the number it got in its financial year. When its date is
 * moved into another FY, say so (the number is not re-allocated).
 */
export function numberFyWarning(
  numberFy: string | null | undefined,
  iso: string | null | undefined,
): string | null {
  if (!numberFy || !iso) return null;
  return financialYear(iso) === numberFy ? null : `Number belongs to FY ${numberFy}`;
}

/** Both notes for a finalised document's date, joined. */
export function joinWarnings(...notes: (string | null | undefined)[]): string | null {
  const shown = notes.filter((n): n is string => !!n);
  return shown.length ? shown.join(" · ") : null;
}

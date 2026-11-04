import type { IsoDate } from "@/lib/types";

/** Today in India as yyyy-mm-dd (the company works in IST). */
function todayIso(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/** An expiry date as dd-mm-yyyy; red and bold once it is before today. Empty shows "—". */
export function ExpiryDate({ date }: { date: IsoDate | null }) {
  if (!date) return <>—</>;
  const [y, m, d] = date.split("-");
  const shown = `${d}-${m}-${y}`;
  if (date >= todayIso()) return <>{shown}</>;
  return (
    <span className="font-semibold text-danger">
      {shown}
      <span className="sr-only"> (expired)</span>
    </span>
  );
}

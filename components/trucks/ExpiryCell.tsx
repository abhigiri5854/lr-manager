import { Chip } from "@/components/ui/Chip";
import { expiryStatus } from "@/lib/expiry";
import { formatDate } from "@/lib/format";
import type { IsoDate } from "@/lib/types";

/** A document date: plain when valid, amber within 15 days, red once expired, grey "not set". */
export function ExpiryCell({ date, today }: { date: IsoDate | null; today: IsoDate }) {
  const status = expiryStatus(date, today);
  if (status.state === "unset" || !date) return <Chip tone="grey">Not set</Chip>;
  const text = formatDate(date);
  if (status.state === "expired") return <Chip tone="red">{text} · expired</Chip>;
  if (status.state === "soon") {
    const left =
      status.daysLeft === 0 ? "today" : `${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"}`;
    return (
      <Chip tone="amber">
        {text} · {left}
      </Chip>
    );
  }
  return <>{text}</>;
}

import { Chip, type ChipTone } from "@/components/ui/Chip";
import type { LrStatus } from "@/lib/types";

// Draft grey and In transit blue come from the designs; the rest follow the same scheme:
// amber = waiting on someone, green = done, red = cancelled.
const tones: Record<LrStatus, ChipTone> = {
  Draft: "grey",
  Booked: "blue",
  "In transit": "blue",
  Delivered: "amber",
  "POD received": "green",
  Billed: "blue",
  Paid: "green",
  Cancelled: "red",
};

/** Status pill for an LR. `note` is appended, e.g. "Draft · from invoice". */
export function LrStatusChip({ status, note }: { status: LrStatus; note?: string }) {
  return <Chip tone={tones[status]}>{note ? `${status} · ${note}` : status}</Chip>;
}

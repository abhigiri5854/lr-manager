import { Chip, type ChipTone } from "@/components/ui/Chip";
import { billStatusLabel } from "@/lib/bill-status";
import type { BillStatus } from "@/lib/validators/bill-list";

const tones: Record<BillStatus, ChipTone> = {
  draft: "grey",
  final: "blue",
  part: "amber",
  paid: "green",
  cancelled: "red",
};

/** Status pill for a freight bill (lib/bill-status.ts decides which). */
export function BillStatusChip({ status }: { status: BillStatus }) {
  return <Chip tone={tones[status]}>{billStatusLabel[status]}</Chip>;
}

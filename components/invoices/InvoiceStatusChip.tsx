import { Chip, type ChipTone } from "@/components/ui/Chip";
import type { TaxInvoiceStatus } from "@/lib/types";

const tones: Record<TaxInvoiceStatus, ChipTone> = {
  draft: "grey",
  final: "green",
  cancelled: "red",
};
const labels: Record<TaxInvoiceStatus, string> = {
  draft: "Draft",
  final: "Final",
  cancelled: "CANCELLED",
};

export const invoiceStatusLabel = labels;

/** Status pill for a tax invoice. */
export function InvoiceStatusChip({ status }: { status: TaxInvoiceStatus }) {
  return <Chip tone={tones[status]}>{labels[status]}</Chip>;
}

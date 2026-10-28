// Words shown on the Smart import screen for a batch.
import type { ImportBatch } from "@/lib/types";
import { FORMAT_LABEL } from "./file-types";

/** Same tones as components/ui/Chip. */
export type ChipTone = "blue" | "amber" | "green" | "grey" | "red";

/** "Tax invoice · photo", "Excel booking report", … */
export function detectedLabel(b: Pick<ImportBatch, "detectedAs" | "kind">): string {
  const how = b.kind === "image" ? "photo" : b.kind === "pdf" ? "PDF" : "Excel";
  switch (b.detectedAs) {
    case "booking_report":
      return b.kind === "csv" ? "CSV booking report" : "Excel booking report";
    case "tax_invoice":
      return `Tax invoice · ${how}`;
    case "lr":
      return `Consignment note · ${how}`;
    case "pod":
      return `POD · ${how}`;
    case "eway_bill":
      return `E-way bill · ${how}`;
    default:
      return "Unknown document";
  }
}

/** Where a file's records end up (the "Goes to" column). */
export function goesToLabel(b: Pick<ImportBatch, "detectedAs">): string {
  switch (b.detectedAs) {
    case "booking_report":
      return "LR register · parties · trucks";
    case "tax_invoice":
      return "Tax invoices · parties";
    case "lr":
      return "LR register";
    case "pod":
      return "POD";
    default:
      return "—";
  }
}

export const formatLabel = (b: Pick<ImportBatch, "format">): string => FORMAT_LABEL[b.format];

/**
 * How many of the four steps (Upload → Read & map → Review → Import) are done for this file.
 * With no file chosen nothing is done yet.
 */
export function stepsDone(status: ImportBatch["status"] | null): number {
  switch (status) {
    case null:
      return 0;
    case "uploaded":
      return 1;
    case "read":
    case "reviewed":
    case "failed":
      return 2;
    case "imported":
      return 4;
  }
}

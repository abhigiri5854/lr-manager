import type { LrStatus, LrStatusInput } from "@/lib/types";

/**
 * The one place an LR's status is decided. Later stages win:
 * Cancelled > Paid > Billed > POD received > Delivered > In transit > Booked > Draft.
 */
export function deriveLrStatus(lr: LrStatusInput): LrStatus {
  if (lr.cancelledAt) return "Cancelled";
  if (!lr.bookedAt) return "Draft";
  if (lr.paidAt) return "Paid";
  if (lr.billedAt) return "Billed";
  if (lr.podReceivedAt) return "POD received";
  if (lr.deliveredAt) return "Delivered";
  if (lr.dispatchedAt) return "In transit";
  return "Booked";
}

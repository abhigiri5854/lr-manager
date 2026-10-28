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

/** Goods are still moving (or about to): the e-way bill must stay valid. */
export function isGoodsMoving(status: LrStatus): boolean {
  return status === "Draft" || status === "Booked" || status === "In transit";
}

export type EwayUrgency = "expired" | "expiring";

const DAY_MS = 86_400_000;

/**
 * "expired" once the e-way bill's validity has passed, "expiring" within 24 hours of it,
 * else null. Only matters while goods are moving; delivered LRs never get flagged.
 */
export function ewayUrgency(
  status: LrStatus,
  ewayExpiresAt: string | null,
  nowMs: number,
): EwayUrgency | null {
  if (!ewayExpiresAt || !isGoodsMoving(status)) return null;
  const left = Date.parse(ewayExpiresAt) - nowMs;
  if (left < 0) return "expired";
  return left <= DAY_MS ? "expiring" : null;
}

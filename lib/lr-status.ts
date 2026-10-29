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

/** What the three cached LR stamps are worked out from. */
export type LrLinkedRecords = {
  /** The LR's live (not cancelled) POD. */
  pod: { receivedAt: string | null } | null;
  /** The live, finalised freight bill carrying the LR (drafts don't count). */
  finalBill: { billDate: string; amountPaise: number } | null;
  /** Allocations to that bill from live payments. */
  allocations: { amountPaise: number; receivedOn: string }[];
};

/**
 * podReceivedAt / billedAt / paidAt as stored on the LR. Paid = the bill's allocations cover
 * its amount; the date is the latest payment's.
 */
export function lrStampsFrom(
  linked: LrLinkedRecords,
): Pick<LrStatusInput, "podReceivedAt" | "billedAt" | "paidAt"> {
  const bill = linked.finalBill;
  const received = linked.allocations.reduce((s, a) => s + a.amountPaise, 0);
  const paid = bill !== null && received >= bill.amountPaise;
  return {
    podReceivedAt: linked.pod?.receivedAt ?? null,
    billedAt: bill?.billDate ?? null,
    paidAt: paid ? (linked.allocations.map((a) => a.receivedOn).sort().at(-1) ?? null) : null,
  };
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

export const LR_STAGES = [
  "Booked",
  "In transit",
  "Delivered",
  "POD received",
  "Billed",
  "Paid",
] as const;
export type LrStage = (typeof LR_STAGES)[number];

export type TimelineStep = {
  /** "Draft" only appears, alone and first, on an LR that isn't booked yet. */
  stage: LrStage | "Draft";
  /** ISO date or timestamp the stage was reached, null if not yet. */
  at: string | null;
  /** "current" is the next stage to happen; a cancelled LR has none. */
  state: "done" | "current" | "upcoming";
};

/** Booked → In transit → Delivered → POD received → Billed → Paid, with when each was reached. */
export function lrTimeline(lr: LrStatusInput): TimelineStep[] {
  const at: Record<LrStage, string | null> = {
    Booked: lr.bookedAt,
    "In transit": lr.dispatchedAt,
    Delivered: lr.deliveredAt,
    "POD received": lr.podReceivedAt,
    Billed: lr.billedAt,
    Paid: lr.paidAt,
  };
  if (!lr.cancelledAt && !lr.bookedAt) {
    return [
      { stage: "Draft", at: null, state: "current" },
      ...LR_STAGES.map((stage) => ({ stage, at: null, state: "upcoming" as const })),
    ];
  }
  let currentTaken = !!lr.cancelledAt;
  return LR_STAGES.map((stage) => {
    if (at[stage]) return { stage, at: at[stage], state: "done" };
    if (currentTaken) return { stage, at: null, state: "upcoming" };
    currentTaken = true;
    return { stage, at: null, state: "current" };
  });
}

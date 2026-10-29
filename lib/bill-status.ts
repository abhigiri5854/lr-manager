// The one place a freight bill's status is worked out (like lib/lr-status.ts for LRs).
// Draft / Final / Part-paid / Paid / Cancelled come from the bill's own state plus the payment
// allocations against it; nothing sets them by hand.
import type { BillStatus } from "@/lib/validators/bill-list";

export const billStatusLabel: Record<BillStatus, string> = {
  draft: "Draft",
  final: "Final",
  part: "Part-paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

export function billPaymentStatus(b: {
  status: "draft" | "final";
  cancelledAt?: string | null;
  totals: { amountPaise: number };
  receivedPaise: number;
}): BillStatus {
  if (b.cancelledAt) return "cancelled";
  if (b.status === "draft") return "draft";
  if (b.receivedPaise <= 0) return "final";
  return b.receivedPaise >= b.totals.amountPaise ? "paid" : "part";
}

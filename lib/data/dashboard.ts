import type { AttentionItem, Dashboard, LrView, RepeatRoute } from "@/lib/types";
import { lrBookingErrors } from "@/lib/validators/lr";
import { billForLr, receivedForBill, toLrView } from "./_derive";
import { db, now, scoped } from "./_store";
import { listPodPending } from "./pod";

type EwayAlert = Extract<AttentionItem, { kind: "eway_expired" | "eway_expiring" }>;

const DAY_MS = 86_400_000;
const RECENT_LRS = 10;
const REPEAT_ROUTES = 3;
/** Goods worth more than this need an e-way bill (GST rule, ₹50,000). */
const EWAY_THRESHOLD_PAISE = 50_000_00;

/** Short names for what a draft still needs, keyed by lrBookingErrors() paths. */
const BOOKING_LABELS: Record<string, string> = {
  lrDate: "LR date",
  fromPlace: "from place",
  toPlace: "to place",
  consignorId: "consignor",
  consigneeId: "consignee",
  paymentMode: "payment mode",
  items: "items",
};

/** Goods are still moving: the e-way bill must stay valid. */
const isOpen = (lr: LrView) =>
  lr.status === "Draft" || lr.status === "Booked" || lr.status === "In transit";

function draftMissing(lr: LrView): string[] {
  const missing = lrBookingErrors(lr).map((e) => BOOKING_LABELS[e.path] ?? e.path);
  const needsEway = lr.lrInvoices.some(
    (i) => !i.ewayBillNo && (i.valuePaise === null || i.valuePaise > EWAY_THRESHOLD_PAISE),
  );
  if (needsEway) missing.push("e-way bill no.");
  if (!lr.items.some((i) => i.chargedWeight || i.actualWeight)) missing.push("weight");
  return missing;
}

/** Booked LRs only (drafts and cancelled LRs don't count); "last used" is the LR date. */
function repeatRoutes(lrs: LrView[]): RepeatRoute[] {
  type BookedLr = LrView & { lrDate: string; consignorName: string; consigneeName: string };
  const pairs = new Map<string, BookedLr[]>();
  for (const lr of lrs) {
    if (!lr.bookedAt || lr.cancelledAt || !lr.lrDate) continue;
    if (!lr.consignorName || !lr.consigneeName) continue;
    const key = `${lr.consignorId}:${lr.consigneeId}`;
    pairs.set(key, [...(pairs.get(key) ?? []), lr as BookedLr]);
  }
  return [...pairs.values()]
    .map((group) => {
      const latest = group.reduce((a, b) =>
        b.lrDate > a.lrDate || (b.lrDate === a.lrDate && b.createdAt > a.createdAt) ? b : a,
      );
      return {
        lrId: latest.id,
        consignorName: latest.consignorName,
        consigneeName: latest.consigneeName,
        fromPlace: latest.fromPlace,
        toPlace: latest.toPlace,
        chargedAs: latest.chargedAs,
        paymentMode: latest.paymentMode,
        lastUsedOn: latest.lrDate,
        count: group.length,
      };
    })
    .sort((a, b) => b.count - a.count || b.lastUsedOn.localeCompare(a.lastUsedOn))
    .slice(0, REPEAT_ROUTES);
}

/** Everything the dashboard shows, for one company. */
export async function getDashboard(companyId: string): Promise<Dashboard> {
  const company = db.companies.find((c) => c.id === companyId);
  const nowMs = Date.parse(now());
  const lrs = scoped(db.lrs, companyId)
    .map(toLrView)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const count = (status: LrView["status"]) => lrs.filter((lr) => lr.status === status).length;
  const openLrs = {
    draft: count("Draft"),
    booked: count("Booked"),
    inTransit: count("In transit"),
  };

  // E-way bills on undelivered LRs, expired or expiring within 24 h, earliest first.
  const ewayAlerts: EwayAlert[] = lrs
    .filter(isOpen)
    .flatMap((lr) =>
      lr.lrInvoices
        .filter((i) => i.ewayBillNo && i.ewayExpiresAt)
        .filter((i) => Date.parse(i.ewayExpiresAt!) - nowMs <= DAY_MS)
        .map((i): EwayAlert => ({
          kind: Date.parse(i.ewayExpiresAt!) < nowMs ? "eway_expired" : "eway_expiring",
          lrId: lr.id,
          lrNo: lr.lrNo,
          ewayBillNo: i.ewayBillNo!,
          expiresAt: i.ewayExpiresAt!,
        })),
    )
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));

  const podPending = await listPodPending(companyId);
  const podDays = company?.podDays ?? null;
  const podAlerts: AttentionItem[] =
    podDays === null
      ? []
      : podPending
          .filter((p) => p.daysSinceDelivery > podDays)
          .map((p) => ({
            kind: "pod_overdue",
            lrId: p.lrId,
            lrNo: p.lrNo,
            daysOverdue: p.daysSinceDelivery - podDays,
            podDays,
            penaltyPerDayPaise: company?.podPenaltyPerDay ?? null,
            penaltyPaise: p.penaltyPaise,
          }));

  const draftAlerts: AttentionItem[] = lrs
    .filter((lr) => lr.status === "Draft")
    .map((lr) => ({ kind: "draft_incomplete" as const, lr, missing: draftMissing(lr) }))
    .filter((d) => d.missing.length > 0)
    .map(({ lr, missing }) => ({ kind: "draft_incomplete", lrId: lr.id, lrNo: lr.lrNo, missing }));

  const finalBills = scoped(db.freightBills, companyId).filter((b) => b.status === "final");
  const toCollect = finalBills.reduce(
    (sum, b) => sum + Math.max(0, b.totals.amountPaise - receivedForBill(companyId, b.id)),
    0,
  );

  return {
    openLrs: { total: openLrs.draft + openLrs.booked + openLrs.inTransit, ...openLrs },
    eway: {
      total: ewayAlerts.length,
      expired: ewayAlerts.filter((a) => a.kind === "eway_expired").length,
    },
    pod: { pending: podPending.length, podDays },
    freight: {
      toCollectPaise: finalBills.length ? toCollect : null,
      unbilledTbbLrs: lrs.filter(
        (lr) => lr.bookedAt && lr.paymentMode === "tbb" && !billForLr(companyId, lr.id),
      ).length,
    },
    recentLrs: lrs.slice(0, RECENT_LRS),
    attention: [...ewayAlerts, ...podAlerts, ...draftAlerts],
    repeatRoutes: repeatRoutes(lrs),
  };
}

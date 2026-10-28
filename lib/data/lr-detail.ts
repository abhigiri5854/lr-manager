import { describeAudit } from "@/lib/lr-activity";
import { lrTimeline, type TimelineStep } from "@/lib/lr-status";
import type { FreightBillView, LrView, Paise, Pod, PartySnapshot } from "@/lib/types";
import { billForLr, billPaidOn, toLrView } from "./_derive";
import { billingPartyFor } from "./billing-party";
import { db, findById, scoped } from "./_store";
import { getFreightBillById } from "./bills";
import { listPodPending } from "./pod";

export type DetailParty = {
  name: string;
  place: string | null;
  gstin: string | null;
  /** Billed-to only: the LR has no billed-to party, so the consignee pays. */
  sameAsConsignee?: boolean;
};

export type DetailInvoice = {
  id: string;
  invoiceNo: string;
  invoiceDate: string | null;
  valuePaise: Paise | null;
  ewayBillNo: string | null;
  ewayExpiresAt: string | null;
  /** The tax invoice this was made from, when it exists in the system. */
  taxInvoice: { id: string; hasSourceFile: boolean } | null;
};

export type ActivityRow = {
  id: string;
  at: string;
  /** User's name, or "system" for imports. Null when the history wasn't recorded. */
  by: string | null;
  text: string;
};

export type LrDetail = {
  lr: LrView;
  consignor: DetailParty | null;
  consignee: DetailParty | null;
  billedTo: DetailParty | null;
  invoices: DetailInvoice[];
  driver: { mobile: string; name: string | null } | null;
  pod: Pod | null;
  bill: FreightBillView | null;
  /** Date the bill was fully paid. */
  paidOn: string | null;
  timeline: TimelineStep[];
  /** The company's POD rules, for the timeline hint and the overdue alert. */
  podDays: number | null;
  podPenaltyPerDayPaise: Paise | null;
  podOverdue: { daysOverdue: number; penaltyPaise: Paise } | null;
  /** Printed LR copies, e.g. ["Consignor", "Consignee", "Driver", "Office"]. */
  lrCopies: string[];
  activity: ActivityRow[];
};

/** Snapshot (what the LR was booked with) wins over the live party record. */
function detailParty(
  snap: PartySnapshot | null | undefined,
  liveId: string | null,
  companyId: string,
): DetailParty | null {
  const p = snap ?? (liveId ? findById(db.parties, companyId, liveId) : null);
  return p ? { name: p.name, place: p.place, gstin: p.gstin } : null;
}

/** Everything the LR detail screen shows, or null if the LR isn't in this company. */
export async function getLrDetail(companyId: string, id: string): Promise<LrDetail | null> {
  const raw = findById(db.lrs, companyId, id);
  if (!raw) return null;
  const lr = toLrView(raw);
  const company = db.companies.find((c) => c.id === companyId);

  const pod = scoped(db.pods, companyId).find((p) => p.lrId === id) ?? null;
  const bill = billForLr(companyId, id);
  const billView = bill ? await getFreightBillById(companyId, bill.id) : null;
  const finalBill = bill?.status === "final" ? bill : undefined;
  const paidOn = finalBill ? billPaidOn(companyId, finalBill) : null;

  const driverRow = raw.driverMobile
    ? scoped(db.drivers, companyId).find((d) => d.mobile === raw.driverMobile)
    : undefined;

  const pending = (await listPodPending(companyId)).find((r) => r.lrId === id);
  const podDays = company?.podDays ?? null;
  const podOverdue =
    pending && podDays !== null && pending.daysSinceDelivery > podDays
      ? { daysOverdue: pending.daysSinceDelivery - podDays, penaltyPaise: pending.penaltyPaise }
      : null;

  const userName = (uid: string) =>
    uid === "system" ? "system" : (db.users.find((u) => u.id === uid)?.name ?? "Unknown user");
  const podIds = new Set(pod ? [pod.id] : []);
  const activity: ActivityRow[] = db.audit
    .filter(
      (a) =>
        a.companyId === companyId &&
        ((a.table === "lrs" && a.recordId === id) ||
          (a.table === "pods" && podIds.has(a.recordId))),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => ({
      id: a.id,
      at: a.createdAt,
      by: userName(a.userId),
      text:
        a.table === "pods"
          ? `POD ${a.action === "create" ? "recorded" : a.action === "cancel" ? "cancelled" : "updated"}`
          : describeAudit(a, raw.cancelReason),
    }));
  // Sample data was never written through the audit log; show the creation from the record itself.
  if (!activity.some((a) => a.text === "LR created")) {
    activity.push({ id: "created", at: raw.createdAt, by: null, text: "LR created" });
  }

  return {
    lr,
    consignor: detailParty(raw.snapshot?.consignor, raw.consignorId, companyId),
    consignee: detailParty(raw.snapshot?.consignee, raw.consigneeId, companyId),
    billedTo: billingPartyFor(raw),
    invoices: raw.lrInvoices.map((i) => {
      const ti = i.taxInvoiceId ? findById(db.taxInvoices, companyId, i.taxInvoiceId) : undefined;
      return {
        id: i.id,
        invoiceNo: i.invoiceNo,
        invoiceDate: i.invoiceDate,
        valuePaise: i.valuePaise,
        ewayBillNo: i.ewayBillNo,
        ewayExpiresAt: i.ewayExpiresAt,
        taxInvoice: ti ? { id: ti.id, hasSourceFile: !!ti.sourceFileUrl } : null,
      };
    }),
    driver: raw.driverMobile ? { mobile: raw.driverMobile, name: driverRow?.name ?? null } : null,
    pod,
    bill: billView,
    paidOn,
    timeline: lrTimeline({
      cancelledAt: raw.cancelledAt,
      bookedAt: raw.bookedAt,
      dispatchedAt: raw.dispatchedAt,
      deliveredAt: raw.deliveredAt,
      podReceivedAt: pod?.receivedAt ?? null,
      billedAt: finalBill?.billDate ?? null,
      paidAt: paidOn,
    }),
    podDays,
    podPenaltyPerDayPaise: company?.podPenaltyPerDay ?? null,
    podOverdue,
    lrCopies: raw.snapshot?.company.lrCopies ?? company?.lrCopies ?? [],
    activity,
  };
}

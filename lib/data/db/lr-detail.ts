// The LR detail screen on the database (DATA_SOURCE=db). Same output as the mock half of
// ../lr-detail.ts. Everything is read in one pipelined round trip.
import { daysBetween } from "@/lib/fy";
import { describeAudit } from "@/lib/lr-activity";
import { lrTimeline } from "@/lib/lr-status";
import { podPenaltyPaise } from "@/lib/pod-rules";
import type { AuditEntry, Lr, PartySnapshot } from "@/lib/types";
import { statusInputOf } from "../_derive";
import { today } from "../_store";
import { billingPartyOf } from "../billing-party";
import type { ActivityRow, DetailParty, LrDetail } from "../lr-detail";
import { withUserRead } from "./conn";
import { isUuid, lrViewCols } from "./lrs";
import { toLr, toLrView, toPod, type Row } from "./rows";

const detailParty = (
  snap: PartySnapshot | null | undefined,
  live: PartySnapshot | undefined,
): DetailParty | null => {
  const p = snap ?? live;
  return p ? { name: p.name, place: p.place, gstin: p.gstin } : null;
};

export async function getLrDetail(companyId: string, id: string): Promise<LrDetail | null> {
  if (!isUuid(id)) return null;
  return withUserRead(async (tx) => {
    const [[row], [podRow], [bill], [company], parties, links, audits] = await Promise.all([
      tx`select l.* ${lrViewCols(tx)(tx`l`)} from lrs l where l.company_id = ${companyId} and l.id = ${id}`,
      tx`select * from pods where company_id = ${companyId} and lr_id = ${id} and cancelled_at is null`,
      tx`select b.bill_no, b.bill_date from freight_bill_lines fl
           join freight_bills b on b.company_id = fl.company_id and b.id = fl.freight_bill_id
          where fl.company_id = ${companyId} and fl.lr_id = ${id} and fl.bill_cancelled_at is null
          limit 1`,
      tx`select pod_days, pod_penalty_per_day_paise, lr_copies from companies where id = ${companyId}`,
      // Live parties and the driver, for what the snapshot doesn't hold.
      tx`select p.id, p.name, p.place, p.gstin, p.pan, p.phone, p.address, p.state_code, p.pincode
           from parties p
          where p.company_id = ${companyId}
            and p.id in (select unnest(array[consignor_id, consignee_id, billed_to_id]) from lrs
                          where company_id = ${companyId} and id = ${id})`,
      tx`select i.id, i.source_file_path is not null as has_source from tax_invoices i
          where i.company_id = ${companyId}
            and i.id in (select tax_invoice_id from lr_invoices where company_id = ${companyId} and lr_id = ${id})`,
      tx`select a.id, a.created_at, a.table_name, a.action, a.changes, a.user_id, u.name as user_name
           from audit_log a left join users u on u.id = a.user_id
          where a.company_id = ${companyId}
            and ((a.table_name = 'lrs' and a.record_id = ${id})
                 or (a.table_name = 'pods' and a.record_id in
                      (select id from pods where company_id = ${companyId} and lr_id = ${id})))
          order by a.created_at desc, a.id`,
    ]);
    if (!row || !company) return null;
    const lr = toLrView(row);
    const raw: Lr = toLr(row);
    const [driver] = raw.driverMobile
      ? await tx`select name from drivers where company_id = ${companyId}
                    and mobile = ${raw.driverMobile} and cancelled_at is null limit 1`
      : [];

    const live = new Map<string, PartySnapshot>(
      (parties as Row[]).map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          place: p.place,
          gstin: p.gstin,
          pan: p.pan,
          phone: p.phone,
          address: p.address,
          stateCode: p.state_code,
          pincode: p.pincode,
        },
      ]),
    );
    const linked = new Map((links as Row[]).map((l) => [l.id as string, l.has_source as boolean]));

    // Delivered but the signed copy hasn't arrived: late once past the company's POD days.
    const podDays: number | null = company.pod_days;
    const penaltyPerDay: number | null = company.pod_penalty_per_day_paise;
    let podOverdue: LrDetail["podOverdue"] = null;
    if (raw.deliveredAt && !raw.podReceivedAt && !raw.cancelledAt) {
      const asOf = today();
      const days = daysBetween(raw.deliveredAt, asOf);
      if (podDays !== null && days > podDays) {
        podOverdue = {
          daysOverdue: days - podDays,
          penaltyPaise: podPenaltyPaise(raw.deliveredAt.slice(0, 10), asOf, {
            podDays,
            podPenaltyPerDay: penaltyPerDay,
          }),
        };
      }
    }

    const activity: ActivityRow[] = (audits as Row[]).map((a) => ({
      id: a.id,
      at: a.created_at,
      by: a.user_id ? (a.user_name ?? "Unknown user") : "system",
      text:
        a.table_name === "pods"
          ? `POD ${a.action === "create" ? "recorded" : a.action === "cancel" ? "cancelled" : "updated"}`
          : describeAudit(a as unknown as AuditEntry, raw.cancelReason),
    }));
    if (!activity.some((a) => a.text === "LR created")) {
      activity.push({ id: "created", at: raw.createdAt, by: null, text: "LR created" });
    }

    return {
      lr,
      consignor: detailParty(raw.snapshot?.consignor, raw.consignorId ? live.get(raw.consignorId) : undefined),
      consignee: detailParty(raw.snapshot?.consignee, raw.consigneeId ? live.get(raw.consigneeId) : undefined),
      billedTo: billingPartyOf(raw, (pid) => live.get(pid)),
      invoices: raw.lrInvoices.map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        invoiceDate: i.invoiceDate,
        valuePaise: i.valuePaise,
        ewayBillNo: i.ewayBillNo,
        ewayExpiresAt: i.ewayExpiresAt,
        taxInvoice: i.taxInvoiceId
          ? { id: i.taxInvoiceId, hasSourceFile: linked.get(i.taxInvoiceId) ?? false }
          : null,
      })),
      driver: raw.driverMobile ? { mobile: raw.driverMobile, name: driver?.name ?? null } : null,
      pod: podRow ? toPod(podRow) : null,
      bill: bill ? { billNo: bill.bill_no, billDate: bill.bill_date } : null,
      paidOn: raw.paidAt,
      timeline: lrTimeline(statusInputOf(raw)),
      podDays,
      podPenaltyPerDayPaise: penaltyPerDay,
      podOverdue,
      lrCopies: raw.snapshot?.company.lrCopies ?? company.lr_copies ?? [],
      activity,
    };
  });
}

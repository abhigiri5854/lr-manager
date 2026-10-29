// The dashboard on the database (DATA_SOURCE=db). Same output as the mock half of ../dashboard.ts.
// Counts, alerts and recent LRs are SQL aggregates read in one pipelined round trip.
import type { AttentionItem, Dashboard, LrView, RepeatRoute } from "@/lib/types";
import { today } from "../_store";
import { draftMissing } from "../dashboard";
import { withUserRead } from "./conn";
import { listExpiryAlerts } from "./trucks";
import { LR_SELECT, MOVING_SQL, STATUS_SQL } from "./lrs";
import { PENDING_COLS, toPendingItem } from "./pod";
import { toLrView, type Row } from "./rows";

type EwayAlert = Extract<AttentionItem, { kind: "eway_expired" | "eway_expiring" }>;

const RECENT_LRS = 10;
const REPEAT_ROUTES = 3;

export async function getDashboard(companyId: string): Promise<Dashboard> {
  const asOf = today();
  return withUserRead(async (tx) => {
    const [[counts], eway, pending, [freight], recent, drafts, routes, expiryAlerts, [company]] =
      await Promise.all([
        tx`select count(*) filter (where ${tx.unsafe(STATUS_SQL)} = 'Draft') as draft,
                  count(*) filter (where ${tx.unsafe(STATUS_SQL)} = 'Booked') as booked,
                  count(*) filter (where ${tx.unsafe(STATUS_SQL)} = 'In transit') as in_transit,
                  count(*) filter (where l.booked_at is not null and l.payment_mode = 'tbb'
                    and l.cancelled_at is null and not exists (
                      select 1 from freight_bill_lines fl
                       where fl.company_id = l.company_id and fl.lr_id = l.id
                         and fl.bill_cancelled_at is null)) as unbilled_tbb
             from lrs l where l.company_id = ${companyId} and l.cancelled_at is null`,
        // E-way bills on undelivered LRs, expired or expiring within 24 h, earliest first.
        tx`select l.id as lr_id, l.lr_no, v.eway_bill_no, v.eway_expires_at
             from lr_invoices v join lrs l on l.company_id = v.company_id and l.id = v.lr_id
            where v.company_id = ${companyId} and v.eway_bill_no is not null
              and v.eway_expires_at is not null and ${tx.unsafe(MOVING_SQL)}
              and v.eway_expires_at <= now() + interval '24 hours'
            order by v.eway_expires_at, v.id`,
        // Delivered, signed copy not received (their count, and the late ones).
        tx`select ${PENDING_COLS(tx)}
             from lrs l join companies c on c.id = l.company_id
             left join parties ce on ce.company_id = l.company_id and ce.id = l.consignee_id
            where l.company_id = ${companyId} and l.cancelled_at is null
              and l.delivered_at is not null and l.pod_received_at is null
            order by l.delivered_at, l.id`,
        tx`select count(*) filter (where b.status = 'final' and b.cancelled_at is null) as final_bills,
                  coalesce(sum(greatest(bal.due_paise, 0)), 0)::bigint as to_collect
             from freight_bills b join freight_bill_balances bal on bal.freight_bill_id = b.id
            where b.company_id = ${companyId}`,
        tx`${LR_SELECT(tx)} where l.company_id = ${companyId} and l.cancelled_at is null
            order by l.created_at desc, l.id limit ${RECENT_LRS}`,
        tx`${LR_SELECT(tx)} where l.company_id = ${companyId} and l.cancelled_at is null
              and l.booked_at is null order by l.created_at desc, l.id`,
        tx`with g as (
             select l.*, count(*) over w as n,
                    row_number() over (w order by l.lr_date desc, l.created_at desc) as rn
               from lrs l
              where l.company_id = ${companyId} and l.booked_at is not null and l.cancelled_at is null
                and l.lr_date is not null and l.consignor_id is not null and l.consignee_id is not null
             window w as (partition by l.consignor_id, l.consignee_id))
           select g.id, g.from_place, g.to_place, g.charged_as, g.payment_mode, g.lr_date, g.n,
                  cn.name as consignor_name, ce.name as consignee_name
             from g join parties cn on cn.company_id = g.company_id and cn.id = g.consignor_id
                    join parties ce on ce.company_id = g.company_id and ce.id = g.consignee_id
            where g.rn = 1 order by g.n desc, g.lr_date desc, g.id limit ${REPEAT_ROUTES}`,
        listExpiryAlerts(companyId),
        tx`select pod_days from companies where id = ${companyId}`,
      ]);

    const nowMs = Date.now();
    const ewayAlerts: EwayAlert[] = (eway as Row[]).map((r) => ({
      kind: Date.parse(r.eway_expires_at) < nowMs ? "eway_expired" : "eway_expiring",
      lrId: r.lr_id,
      lrNo: r.lr_no,
      ewayBillNo: r.eway_bill_no,
      expiresAt: r.eway_expires_at,
    }));

    const podItems = (pending as Row[]).map((r) => ({ item: toPendingItem(r, asOf), row: r }));
    const podDays: number | null = company?.pod_days ?? null;
    const podAlerts: AttentionItem[] =
      podDays === null
        ? []
        : podItems
            .filter(({ item }) => item.daysSinceDelivery > podDays)
            .map(({ item, row }) => ({
              kind: "pod_overdue" as const,
              lrId: item.lrId,
              lrNo: item.lrNo,
              daysOverdue: item.daysSinceDelivery - podDays,
              podDays,
              penaltyPerDayPaise: (row.penalty as number | null) ?? null,
              penaltyPaise: item.penaltyPaise,
            }));

    const draftAlerts: AttentionItem[] = (drafts as Row[])
      .map(toLrView)
      .map((lr: LrView) => ({ lr, missing: draftMissing(lr) }))
      .filter((d) => d.missing.length > 0)
      .map(({ lr, missing }) => ({
        kind: "draft_incomplete" as const,
        lrId: lr.id,
        lrNo: lr.lrNo,
        missing,
      }));

    const repeatRoutes: RepeatRoute[] = (routes as Row[]).map((r) => ({
      lrId: r.id,
      consignorName: r.consignor_name,
      consigneeName: r.consignee_name,
      fromPlace: r.from_place,
      toPlace: r.to_place,
      chargedAs: r.charged_as,
      paymentMode: r.payment_mode,
      lastUsedOn: r.lr_date,
      count: r.n,
    }));

    const open = {
      draft: counts.draft as number,
      booked: counts.booked as number,
      inTransit: counts.in_transit as number,
    };
    return {
      openLrs: { total: open.draft + open.booked + open.inTransit, ...open },
      eway: {
        total: ewayAlerts.length,
        expired: ewayAlerts.filter((a) => a.kind === "eway_expired").length,
      },
      pod: { pending: podItems.length, podDays },
      freight: {
        toCollectPaise: (freight.final_bills as number) > 0 ? (freight.to_collect as number) : null,
        unbilledTbbLrs: counts.unbilled_tbb as number,
      },
      recentLrs: (recent as Row[]).map(toLrView),
      attention: [...ewayAlerts, ...podAlerts, ...expiryAlerts, ...draftAlerts],
      repeatRoutes,
    };
  });
}

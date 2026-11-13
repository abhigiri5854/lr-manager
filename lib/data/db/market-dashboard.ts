// Small read-only summaries for the dashboard "Market trucks" row. Company-scoped, one query each.
import { ewbBucket } from "@/lib/hire/ewb-expiry";
import { withUserRead } from "./conn";
import { listEwbLines, listOpenEwbTasks } from "./ewb";

const num = (v: unknown) => Number(v ?? 0);

export type ExpiringDoc = {
  /** vehicle / driver id (for the link) */
  id: string;
  kind: "vehicle" | "driver";
  /** vehicle no or driver name */
  subject: string;
  doc: "Insurance" | "Fitness" | "Permit" | "PUC" | "Driving licence";
  /** yyyy-mm-dd */
  dueOn: string;
  expired: boolean;
};

/** Vehicle insurance / fitness / permit / PUC and driver DL due within `days` days, or already past. */
export async function getExpiringDocs(companyId: string, days: number) {
  return withUserRead(async (tx) => {
    const base = tx`
      select * from (
        select v.id, 'vehicle' as kind, v.vehicle_no as subject, d.doc, d.due
          from market_vehicles v
         cross join lateral (values ('Insurance', v.insurance_upto), ('Fitness', v.fitness_upto),
                                    ('Permit', v.permit_upto), ('PUC', v.puc_upto)) as d(doc, due)
         where v.company_id = ${companyId} and v.cancelled_at is null and d.due is not null
        union all
        select m.id, 'driver', m.name, 'Driving licence', m.dl_upto
          from market_drivers m
         where m.company_id = ${companyId} and m.cancelled_at is null and m.dl_upto is not null
      ) x
       where x.due <= (now() at time zone 'Asia/Kolkata')::date + ${days}::int`;
    const [rows, [t]] = await Promise.all([
      tx`select id, kind, subject, doc, due::text as due,
                (due < (now() at time zone 'Asia/Kolkata')::date) as expired
           from (${base}) b order by due, subject, doc limit 5`,
      tx`select count(*) as n from (${base}) b`,
    ]);
    return {
      total: num(t.n),
      top: rows.map(
        (r): ExpiringDoc => ({
          id: r.id as string,
          kind: r.kind as "vehicle" | "driver",
          subject: r.subject as string,
          doc: r.doc as ExpiringDoc["doc"],
          dueOn: r.due as string,
          expired: !!r.expired,
        }),
      ),
    };
  });
}

export type MovingTruck = {
  challanId: string;
  challanNo: string;
  vehicleNo: string | null;
  source: string | null;
  destination: string | null;
  /** ISO timestamp: the phone's last ping, else the latest trip event */
  lastSeenAt: string;
};

/** Open challans whose latest trip event is Loaded or On the way. */
export async function getTrucksOnTheMove(companyId: string) {
  return withUserRead(async (tx) => {
    const from = tx`
      challans c
      join lateral (select e.type::text as type, e.at from trip_events e
                     where e.company_id = c.company_id and e.challan_id = c.id
                     order by e.at desc limit 1) te on true
      left join market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
      left join lateral (select l.last_located_at from driver_links l
                          where l.company_id = c.company_id and l.market_driver_id = c.driver_id
                            and l.revoked_at is null) dl on true
     where c.company_id = ${companyId} and c.cancelled_at is null
       and c.status::text not in ('draft', 'pod_received', 'settled')
       and c.unloaded_at is null
       and te.type in ('loaded', 'en_route')`;
    const [rows, [t]] = await Promise.all([
      tx`select c.id, c.challan_no, v.vehicle_no, c.source, c.destination,
                greatest(te.at, dl.last_located_at) as seen
           from ${from} order by seen desc, c.id limit 8`,
      tx`select count(*) as n from ${from}`,
    ]);
    return {
      total: num(t.n),
      top: rows.map(
        (r): MovingTruck => ({
          challanId: r.id as string,
          challanNo: r.challan_no as string,
          vehicleNo: (r.vehicle_no as string | null) ?? null,
          source: (r.source as string | null) ?? null,
          destination: (r.destination as string | null) ?? null,
          lastSeenAt: new Date(r.seen as string | Date).toISOString(),
        }),
      ),
    };
  });
}

/** E-way bills on live challans already expired or expiring within 24 h, plus open Part-B tasks. */
export async function getEwbSummary(companyId: string) {
  const now = new Date();
  const [lines, tasks] = await Promise.all([listEwbLines(companyId), listOpenEwbTasks(companyId)]);
  let expired = 0;
  let under24h = 0;
  for (const l of lines) {
    if (!l.validUpto) continue;
    const b = ewbBucket(l.validUpto, now);
    if (b === "expired") expired++;
    else if (b === "under6h" || b === "under24h") under24h++;
  }
  return { expired, under24h, openTasks: tasks.length };
}

export async function countPaymentsAwaitingApproval(companyId: string) {
  return withUserRead(async (tx) => {
    const [t] = await tx`select count(*) as n from truck_payments
      where company_id = ${companyId} and cancelled_at is null and status = 'pending_approval'`;
    return num(t.n);
  });
}

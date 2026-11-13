// Market-truck hire reports (/market-trucks/reports). Every list returns its page of rows plus totals
// over the WHOLE filtered set (not just the page). Money is integer paise.
import { toPaise } from "@/lib/hire";
import type { Page } from "@/lib/types";
import type { ReportFilters } from "@/lib/validators/hire-report";
import { contains, paging, withUserRead, type Tx } from "./conn";
import type { Row } from "./rows";

const EXPORT_MAX = 5000;

type Params = { page?: number; all?: boolean };
export type ReportPage<T, Tot> = Page<T> & { totals: Tot };

const paise = (v: unknown) => toPaise(String(v ?? 0));
const paiseOrNull = (v: unknown) => (v === null || v === undefined ? null : paise(v));
const str = (v: unknown) => (v as string | null) ?? null;
const num = (v: unknown) => Number(v ?? 0);

const lim = (tx: Tx, params: Params, pageSize: number, offset: number) =>
  params.all ? tx`limit ${EXPORT_MAX}` : tx`limit ${pageSize} offset ${offset}`;

function pageOf<T, Tot>(
  rows: T[],
  total: number,
  page: number,
  pageSize: number,
  params: Params,
  totals: Tot,
): ReportPage<T, Tot> {
  return { rows, total, page, pageSize: params.all ? EXPORT_MAX : pageSize, totals };
}

const branchIs = (tx: Tx, f: ReportFilters) =>
  f.branch ? tx`and c.branch_id = ${f.branch}::uuid` : tx``;
const dateIs = (tx: Tx, f: ReportFilters) => tx`
  ${f.from ? tx`and (c.challan_at at time zone 'Asia/Kolkata')::date >= ${f.from}::date` : tx``}
  ${f.to ? tx`and (c.challan_at at time zone 'Asia/Kolkata')::date <= ${f.to}::date` : tx``}`;

// ---------- filter options ----------

export async function getReportOptions(companyId: string) {
  return withUserRead(async (tx) => {
    const [branches, types] = await Promise.all([
      tx`select id, name from branches where company_id = ${companyId} and cancelled_at is null
          order by lower(name), id`,
      tx`select id, name from vehicle_types where company_id = ${companyId} and cancelled_at is null
          order by lower(name), id`,
    ]);
    const pick = (r: Row) => ({ id: r.id as string, name: r.name as string });
    return { branches: branches.map(pick), vehicleTypes: types.map(pick) };
  });
}

// ---------- 1. hire outstanding (per truck party) ----------

export type HireOutstandingRow = {
  partyId: string;
  partyName: string;
  challans: number;
  /** hire + additions − deductions */
  hirePaise: number;
  tdsPaise: number;
  paidPaise: number;
  balancePaise: number;
};
export type HireOutstandingTotals = Omit<HireOutstandingRow, "partyId" | "partyName">;

/** Per payee from v_challan_balance (draft challans left out: nothing is owed on them yet). */
export async function listHireOutstanding(
  companyId: string,
  f: ReportFilters,
  params: Params,
): Promise<ReportPage<HireOutstandingRow, HireOutstandingTotals>> {
  const { page, pageSize, offset } = paging(params);
  const party = contains(f.party);
  return withUserRead(async (tx) => {
    const g = () => tx`
      select vb.payee_party_id as party_id, pp.name as party_name, count(*) as challans,
             sum(vb.hire_amount + vb.additions - vb.deductions) as hire,
             sum(vb.tds_amount) as tds, sum(vb.paid) as paid, sum(vb.balance) as balance
        from v_challan_balance vb
        join challans c on c.company_id = vb.company_id and c.id = vb.challan_id
        join truck_parties pp on pp.company_id = vb.company_id and pp.id = vb.payee_party_id
       where vb.company_id = ${companyId} and c.status <> 'draft'
         ${branchIs(tx, f)}
         ${party ? tx`and lower(pp.name) like ${party}` : tx``}
       group by vb.payee_party_id, pp.name
       ${f.positive ? tx`having sum(vb.balance) > 0` : tx``}`;
    const [rows, [t]] = await Promise.all([
      tx`with g as (${g()}) select * from g
          order by balance desc, lower(party_name), party_id ${lim(tx, params, pageSize, offset)}`,
      tx`with g as (${g()})
         select count(*) as n, coalesce(sum(challans), 0) as challans, coalesce(sum(hire), 0) as hire,
                coalesce(sum(tds), 0) as tds, coalesce(sum(paid), 0) as paid,
                coalesce(sum(balance), 0) as balance from g`,
    ]);
    return pageOf(
      rows.map((r) => ({
        partyId: r.party_id as string,
        partyName: r.party_name as string,
        challans: num(r.challans),
        hirePaise: paise(r.hire),
        tdsPaise: paise(r.tds),
        paidPaise: paise(r.paid),
        balancePaise: paise(r.balance),
      })),
      num(t.n),
      page,
      pageSize,
      params,
      {
        challans: num(t.challans),
        hirePaise: paise(t.hire),
        tdsPaise: paise(t.tds),
        paidPaise: paise(t.paid),
        balancePaise: paise(t.balance),
      },
    );
  });
}

// ---------- 2. POD pending ageing ----------

export type PodBucket = "0-7" | "8-15" | "16-30" | "30+";
export const bucketOf = (days: number): PodBucket =>
  days <= 7 ? "0-7" : days <= 15 ? "8-15" : days <= 30 ? "16-30" : "30+";

export type PodPendingRow = {
  id: string;
  challanNo: string;
  challanDate: string;
  branchName: string;
  vehicleNo: string | null;
  partyId: string | null;
  partyName: string | null;
  source: string | null;
  destination: string | null;
  /** yyyy-mm-dd the clock started: unloaded, else dispatched, else challan date */
  sinceDate: string;
  sinceKind: "unloaded" | "dispatched";
  ageDays: number;
};
export type PodPendingTotals = { n: number; b0_7: number; b8_15: number; b16_30: number; b30p: number };

export async function listPodPending(
  companyId: string,
  f: ReportFilters,
  params: Params,
): Promise<ReportPage<PodPendingRow, PodPendingTotals>> {
  const { page, pageSize, offset } = paging(params);
  const party = contains(f.party);
  const vehicle = contains(f.vehicle?.replace(/\s+/g, ""));
  return withUserRead(async (tx) => {
    const since = () => tx`(coalesce(c.unloaded_at, c.dispatched_at, c.challan_at) at time zone 'Asia/Kolkata')::date`;
    const age = () => tx`((now() at time zone 'Asia/Kolkata')::date - ${since()})`;
    const from = () => tx`challans c
        join branches b on b.company_id = c.company_id and b.id = c.branch_id
        left join market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
        left join truck_parties pp on pp.company_id = c.company_id and pp.id = c.payee_party_id
       where c.company_id = ${companyId} and c.cancelled_at is null and c.status <> 'draft'
         and c.pod_received_at is null
         ${branchIs(tx, f)}
         ${party ? tx`and lower(pp.name) like ${party}` : tx``}
         ${vehicle ? tx`and lower(v.vehicle_no) like ${vehicle}` : tx``}`;
    const [rows, [t]] = await Promise.all([
      tx`select c.id, c.challan_no, (c.challan_at at time zone 'Asia/Kolkata')::date::text as challan_date,
                b.name as branch_name, v.vehicle_no, pp.id as party_id, pp.name as party_name,
                c.source, c.destination, ${since()}::text as since_date,
                (c.unloaded_at is not null) as unloaded, ${age()} as age_days
           from ${from()}
          order by age_days desc, c.challan_no, c.id ${lim(tx, params, pageSize, offset)}`,
      tx`select count(*) as n,
                count(*) filter (where ${age()} <= 7) as b1,
                count(*) filter (where ${age()} between 8 and 15) as b2,
                count(*) filter (where ${age()} between 16 and 30) as b3,
                count(*) filter (where ${age()} > 30) as b4
           from ${from()}`,
    ]);
    return pageOf(
      rows.map((r) => ({
        id: r.id as string,
        challanNo: r.challan_no as string,
        challanDate: r.challan_date as string,
        branchName: r.branch_name as string,
        vehicleNo: str(r.vehicle_no),
        partyId: str(r.party_id),
        partyName: str(r.party_name),
        source: str(r.source),
        destination: str(r.destination),
        sinceDate: r.since_date as string,
        sinceKind: r.unloaded ? ("unloaded" as const) : ("dispatched" as const),
        ageDays: num(r.age_days),
      })),
      num(t.n),
      page,
      pageSize,
      params,
      { n: num(t.n), b0_7: num(t.b1), b8_15: num(t.b2), b16_30: num(t.b3), b30p: num(t.b4) },
    );
  });
}

// ---------- 3. TDS register (v_tds_register, migration 0025) ----------

export type TdsRegisterRow = {
  allocationId: string;
  paidOn: string;
  paymentNo: string;
  challanNo: string;
  partyId: string;
  partyName: string;
  pan: string | null;
  panType: string | null;
  section: string | null;
  /** The challan's gross hire credit (the TDS base). */
  tdsBasePaise: number;
  grossPaise: number;
  tdsPercent: number | null;
  tdsPaise: number;
  netPaise: number;
  /** 0% TDS because the party has a declaration for that FY */
  declaration: boolean;
};
export type TdsQuarterTotal = {
  quarter: string;
  n: number;
  grossPaise: number;
  tdsPaise: number;
  netPaise: number;
};
export type TdsTotals = { grossPaise: number; tdsPaise: number; netPaise: number; quarters: TdsQuarterTotal[] };

export async function listTdsRegister(
  companyId: string,
  f: ReportFilters,
  params: Params,
): Promise<ReportPage<TdsRegisterRow, TdsTotals>> {
  const { page, pageSize, offset } = paging(params);
  const party = contains(f.party);
  return withUserRead(async (tx) => {
    const where = () => tx`t.company_id = ${companyId}
      ${f.fy ? tx`and t.fy = ${f.fy}` : tx``}
      ${f.quarter ? tx`and t.quarter = ${f.quarter}` : tx``}
      ${party ? tx`and lower(t.party_name) like ${party}` : tx``}`;
    const [rows, quarters] = await Promise.all([
      tx`select t.allocation_id, t.paid_on::text as paid_on, t.payment_no, t.challan_no, t.party_id,
                t.party_name, t.pan, t.pan_type, t.tds_base, t.gross_amount, tpay.tds_percent as entered_percent,
                t.tds_amount, t.net_amount, (t.tds_amount = 0 and t.has_declaration) as declaration
           from v_tds_register t
           join truck_payments tpay on tpay.company_id = t.company_id and tpay.id = t.payment_id
          where ${where()}
          order by t.paid_on, t.payment_no, t.challan_no, t.allocation_id
          ${lim(tx, params, pageSize, offset)}`,
      tx`select t.quarter, count(*) as n, sum(t.gross_amount) as gross, sum(t.tds_amount) as tds,
                sum(t.net_amount) as net
           from v_tds_register t where ${where()} group by t.quarter order by t.quarter`,
    ]);
    const qs: TdsQuarterTotal[] = quarters.map((q) => ({
      quarter: q.quarter as string,
      n: num(q.n),
      grossPaise: paise(q.gross),
      tdsPaise: paise(q.tds),
      netPaise: paise(q.net),
    }));
    const sum = (k: "grossPaise" | "tdsPaise" | "netPaise") => qs.reduce((s, q) => s + q[k], 0);
    return pageOf(
      rows.map((r) => ({
        allocationId: r.allocation_id as string,
        paidOn: r.paid_on as string,
        paymentNo: r.payment_no as string,
        challanNo: r.challan_no as string,
        partyId: r.party_id as string,
        partyName: r.party_name as string,
        pan: str(r.pan),
        panType: str(r.pan_type),
        section: "194C",
        tdsBasePaise: paise(r.tds_base),
        grossPaise: paise(r.gross_amount),
        tdsPercent: r.entered_percent === null ? null : Number(r.entered_percent),
        tdsPaise: paise(r.tds_amount),
        netPaise: paise(r.net_amount),
        declaration: !!r.declaration,
      })),
      qs.reduce((s, q) => s + q.n, 0),
      page,
      pageSize,
      params,
      { grossPaise: sum("grossPaise"), tdsPaise: sum("tdsPaise"), netPaise: sum("netPaise"), quarters: qs },
    );
  });
}

// ---------- 4. trip margin (bill.edit only) ----------

export type TripMarginRow = {
  id: string;
  challanNo: string;
  challanDate: string;
  branchName: string;
  vehicleNo: string | null;
  vehicleType: string | null;
  source: string | null;
  destination: string | null;
  /** party freight of the challan's LRs (+ charges billed to the party) */
  revenuePaise: number;
  /** hire + additions − deductions */
  costPaise: number;
  marginPaise: number;
  marginPct: number | null;
  low: boolean;
};
export type TripMarginTotals = {
  revenuePaise: number;
  costPaise: number;
  marginPaise: number;
  marginPct: number | null;
  lowCount: number;
  minMarginPct: number;
};

const pctOf = (margin: number, revenue: number) =>
  revenue > 0 ? Math.round((margin * 10000) / revenue) / 100 : null;
/** Below the company's low-margin setting (0 when unset); no revenue counts as low only when it loses money. */
const isLow = (margin: number, revenue: number, minPct: number) =>
  (revenue > 0 ? (margin * 100) / revenue : margin < 0 ? -1 : 0) < minPct;

export async function listTripMargin(
  companyId: string,
  f: ReportFilters,
  params: Params,
): Promise<ReportPage<TripMarginRow, TripMarginTotals>> {
  const { page, pageSize, offset } = paging(params);
  return withUserRead(async (tx) => {
    const [co] = await tx`select coalesce(min_margin_pct, 0) as m from companies where id = ${companyId}`;
    const minPct = Number(co?.m ?? 0);
    const from = () => tx`challans c
        join v_challan_balance vb on vb.company_id = c.company_id and vb.challan_id = c.id
        join branches b on b.company_id = c.company_id and b.id = c.branch_id
        left join market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
        left join vehicle_types vt on vt.company_id = c.company_id and vt.id = c.vehicle_type_id
       where c.company_id = ${companyId} and c.cancelled_at is null and c.status <> 'draft'
         ${dateIs(tx, f)}
         ${branchIs(tx, f)}
         ${f.vtype ? tx`and c.vehicle_type_id = ${f.vtype}::uuid` : tx``}`;
    const [rows, [t]] = await Promise.all([
      tx`select c.id, c.challan_no, (c.challan_at at time zone 'Asia/Kolkata')::date::text as challan_date,
                b.name as branch_name, v.vehicle_no, vt.name as vehicle_type, c.source, c.destination,
                vb.trip_revenue as revenue, (vb.hire_amount + vb.additions - vb.deductions) as cost
           from ${from()}
          order by c.challan_at desc, c.id desc ${lim(tx, params, pageSize, offset)}`,
      tx`select count(*) as n, coalesce(sum(x.rev), 0) as rev, coalesce(sum(x.cost), 0) as cost,
                count(*) filter (where (case when x.rev > 0 then (x.rev - x.cost) * 100 / x.rev
                                             when x.rev - x.cost < 0 then -1 else 0 end) < ${minPct}::numeric) as low
           from (select vb.trip_revenue as rev, (vb.hire_amount + vb.additions - vb.deductions) as cost
                   from ${from()}) x`,
    ]);
    const revenue = paise(t.rev);
    const cost = paise(t.cost);
    return pageOf(
      rows.map((r) => {
        const rev = paise(r.revenue);
        const cst = paise(r.cost);
        return {
          id: r.id as string,
          challanNo: r.challan_no as string,
          challanDate: r.challan_date as string,
          branchName: r.branch_name as string,
          vehicleNo: str(r.vehicle_no),
          vehicleType: str(r.vehicle_type),
          source: str(r.source),
          destination: str(r.destination),
          revenuePaise: rev,
          costPaise: cst,
          marginPaise: rev - cst,
          marginPct: pctOf(rev - cst, rev),
          low: isLow(rev - cst, rev, minPct),
        };
      }),
      num(t.n),
      page,
      pageSize,
      params,
      {
        revenuePaise: revenue,
        costPaise: cost,
        marginPaise: revenue - cost,
        marginPct: pctOf(revenue - cost, revenue),
        lowCount: num(t.low),
        minMarginPct: minPct,
      },
    );
  });
}

// ---------- 5. lane rates ----------

export type LaneRateRow = {
  key: string;
  source: string;
  destination: string;
  vehicleType: string | null;
  rateBasis: "trip" | "per_tonne";
  trips: number;
  /** Per-trip lanes: hire amount; per-tonne lanes: rate per tonne (₹/t). */
  minPaise: number;
  avgPaise: number;
  maxPaise: number;
  lastPaise: number;
  /** yyyy-mm-dd of the latest trip */
  lastDate: string;
};
export type LaneRateTotals = { trips: number };

/** Hire per lane (route + vehicle type) over the date range; not capped like v_lane_rates (last 10). */
export async function listLaneRates(
  companyId: string,
  f: ReportFilters,
  params: Params,
): Promise<ReportPage<LaneRateRow, LaneRateTotals>> {
  const { page, pageSize, offset } = paging(params);
  return withUserRead(async (tx) => {
    const g = () => tx`
      select (array_agg(c.source order by c.challan_at desc))[1] as source,
             (array_agg(c.destination order by c.challan_at desc))[1] as destination,
             c.vehicle_type_id, c.rate_basis::text as rate_basis, count(*) as trips,
             min(case when c.rate_basis = 'per_tonne' then c.rate else c.hire_amount end) as min_hire,
             round(avg(case when c.rate_basis = 'per_tonne' then c.rate else c.hire_amount end), 2) as avg_hire,
             max(case when c.rate_basis = 'per_tonne' then c.rate else c.hire_amount end) as max_hire,
             (array_agg(case when c.rate_basis = 'per_tonne' then c.rate else c.hire_amount end
                        order by c.challan_at desc))[1] as last_hire,
             (max(c.challan_at) at time zone 'Asia/Kolkata')::date::text as last_date
        from challans c
       where c.company_id = ${companyId} and c.cancelled_at is null and c.status <> 'draft'
         and c.hire_amount > 0
         and coalesce(trim(c.source), '') <> '' and coalesce(trim(c.destination), '') <> ''
         ${f.basis ? tx`and c.rate_basis = ${f.basis}` : tx``}
         ${dateIs(tx, f)}
       group by lower(trim(c.source)), lower(trim(c.destination)), c.vehicle_type_id, c.rate_basis`;
    const [rows, [t]] = await Promise.all([
      tx`with g as (${g()})
         select g.*, vt.name as vehicle_type from g
           left join vehicle_types vt on vt.company_id = ${companyId} and vt.id = g.vehicle_type_id
          order by g.trips desc, lower(g.source), lower(g.destination), vt.name, g.rate_basis
          ${lim(tx, params, pageSize, offset)}`,
      tx`with g as (${g()}) select count(*) as n, coalesce(sum(trips), 0) as trips from g`,
    ]);
    return pageOf(
      rows.map((r) => ({
        key: `${r.source}|${r.destination}|${r.vehicle_type_id ?? ""}|${r.rate_basis}`,
        rateBasis: r.rate_basis === "per_tonne" ? ("per_tonne" as const) : ("trip" as const),
        source: r.source as string,
        destination: r.destination as string,
        vehicleType: str(r.vehicle_type),
        trips: num(r.trips),
        minPaise: paise(r.min_hire),
        avgPaise: paise(r.avg_hire),
        maxPaise: paise(r.max_hire),
        lastPaise: paiseOrNull(r.last_hire) ?? 0,
        lastDate: r.last_date as string,
      })),
      num(t.n),
      page,
      pageSize,
      params,
      { trips: num(t.trips) },
    );
  });
}

import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import {
  bucketOf,
  type HireOutstandingRow,
  type HireOutstandingTotals,
  type LaneRateRow,
  type LaneRateTotals,
  type PodPendingRow,
  type PodPendingTotals,
  type ReportPage,
  type TdsRegisterRow,
  type TdsTotals,
  type TripMarginRow,
  type TripMarginTotals,
} from "@/lib/data/db/hire-reports";
import { formatDate, formatPaise } from "@/lib/format";
import { reportSearch, type ReportFilters, type ReportTab } from "@/lib/validators/hire-report";

const BASE = "/market-trucks/reports";
const partyHref = (id: string) => `/market-trucks/parties/${id}`;

export type ReportData =
  | { tab: "hire"; page: ReportPage<HireOutstandingRow, HireOutstandingTotals> }
  | { tab: "pod"; page: ReportPage<PodPendingRow, PodPendingTotals> }
  | { tab: "tds"; page: ReportPage<TdsRegisterRow, TdsTotals> }
  | { tab: "margin"; page: ReportPage<TripMarginRow, TripMarginTotals> }
  | { tab: "lanes"; page: ReportPage<LaneRateRow, LaneRateTotals> };

// ---------- totals row ----------

type Total = { __total: true };
const TOTAL: Total = { __total: true };
const isTotal = (r: unknown): r is Total => typeof r === "object" && r !== null && "__total" in r;

type Col<T> = Omit<Column<T>, "cell"> & { cell: (r: T) => ReactNode; total?: ReactNode };

function withTotal<T>(cols: Col<T>[]): Column<T | Total>[] {
  return cols.map(({ total, cell, ...rest }) => ({
    ...rest,
    cell: (r: T | Total) => (isTotal(r) ? <strong>{total ?? ""}</strong> : cell(r as T)),
  })) as Column<T | Total>[];
}

function ReportCard<T>({
  label,
  columns,
  page,
  rowKey,
  noun,
  hrefFor,
  empty,
}: {
  label: string;
  columns: Col<T>[];
  page: ReportPage<T, unknown>;
  rowKey: (r: T) => string;
  noun: [string, string];
  hrefFor: (p: number) => string;
  empty: ReactNode;
}) {
  const rows: (T | Total)[] = page.rows.length ? [...page.rows, TOTAL] : [];
  return (
    <Card padding="table">
      <DataTable
        label={label}
        columns={withTotal(columns)}
        rows={rows}
        rowKey={(r) => (isTotal(r) ? "__total" : rowKey(r as T))}
        empty={empty}
      />
      <div className="mx-3 mt-4">
        <Pagination
          page={page.page}
          pageSize={page.pageSize}
          total={page.total}
          noun={page.total === 1 ? noun[0] : noun[1]}
          hrefFor={hrefFor}
        />
      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone === "red" ? "text-warning" : ""}`}>{value}</div>
    </div>
  );
}

const route = (s: string | null, d: string | null) => (s || d ? `${s ?? "—"} → ${d ?? "—"}` : "—");
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);

// ---------- tabs ----------

export function ReportTabs({
  tabs,
  active,
}: {
  tabs: { tab: ReportTab; label: string }[];
  active: ReportTab;
}) {
  return (
    <nav aria-label="Reports" className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link
          key={t.tab}
          href={`${BASE}?tab=${t.tab}`}
          aria-current={t.tab === active ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${
            t.tab === active
              ? "border-primary bg-primary-soft text-primary"
              : "border-border bg-surface text-text"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

// ---------- the five reports ----------

export function HireReport({ data, filters }: { data: ReportData; filters: ReportFilters }) {
  const href = (p: number) => `${BASE}${reportSearch(data.tab, filters, p)}`;
  const none = (
    <>
      Nothing matches these filters. <Link href={`${BASE}?tab=${data.tab}`}>Clear filters</Link>
    </>
  );

  switch (data.tab) {
    case "hire": {
      const t = data.page.totals;
      const cols: Col<HireOutstandingRow>[] = [
        {
          key: "party",
          header: "Truck party",
          cell: (r) => <Link href={partyHref(r.partyId)}>{r.partyName}</Link>,
          total: `Total (${data.page.total} parties)`,
          wrap: true,
        },
        { key: "n", header: "Challans", cell: (r) => r.challans, total: t.challans, align: "right" },
        {
          key: "hire",
          header: "Hire + additions − deductions ₹",
          cell: (r) => formatPaise(r.hirePaise),
          total: formatPaise(t.hirePaise),
          align: "right",
        },
        { key: "tds", header: "TDS ₹", cell: (r) => formatPaise(r.tdsPaise), total: formatPaise(t.tdsPaise), align: "right" },
        { key: "paid", header: "Paid ₹", cell: (r) => formatPaise(r.paidPaise), total: formatPaise(t.paidPaise), align: "right" },
        {
          key: "bal",
          header: "Balance ₹",
          cell: (r) => formatPaise(r.balancePaise),
          total: formatPaise(t.balancePaise),
          align: "right",
        },
      ];
      return (
        <ReportCard
          label="Hire outstanding"
          columns={cols}
          page={data.page}
          rowKey={(r) => r.partyId}
          noun={["party", "parties"]}
          hrefFor={href}
          empty={none}
        />
      );
    }

    case "pod": {
      const t = data.page.totals;
      const cols: Col<PodPendingRow>[] = [
        { key: "no", header: "Challan no.", cell: (r) => <Link href={`/market-trucks/challans/${r.id}#pod`}>{r.challanNo}</Link>, mono: true, total: `Total (${t.n})` },
        { key: "date", header: "Date", cell: (r) => formatDate(r.challanDate) },
        { key: "branch", header: "Branch", cell: (r) => r.branchName },
        { key: "veh", header: "Vehicle", cell: (r) => r.vehicleNo ?? "—", mono: true },
        {
          key: "party",
          header: "Party",
          cell: (r) => (r.partyId ? <Link href={partyHref(r.partyId)}>{r.partyName}</Link> : "—"),
          wrap: true,
        },
        { key: "route", header: "Route", cell: (r) => route(r.source, r.destination), wrap: true },
        {
          key: "since",
          header: "Since",
          cell: (r) => `${r.sinceKind === "unloaded" ? "Unloaded" : "Dispatched"} ${formatDate(r.sinceDate)}`,
        },
        { key: "age", header: "Days", cell: (r) => r.ageDays, align: "right" },
        {
          key: "bucket",
          header: "Bucket",
          cell: (r) => <Chip tone={bucketOf(r.ageDays) === "30+" ? "amber" : "grey"}>{bucketOf(r.ageDays)}</Chip>,
        },
      ];
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="0–7 days" value={t.b0_7} />
            <Stat label="8–15 days" value={t.b8_15} />
            <Stat label="16–30 days" value={t.b16_30} />
            <Stat label="30+ days" value={t.b30p} tone={t.b30p > 0 ? "red" : undefined} />
          </div>
          <ReportCard
            label="POD pending"
            columns={cols}
            page={data.page}
            rowKey={(r) => r.id}
            noun={["challan", "challans"]}
            hrefFor={href}
            empty={none}
          />
        </>
      );
    }

    case "tds": {
      const t = data.page.totals;
      const cols: Col<TdsRegisterRow>[] = [
        { key: "date", header: "Payment date", cell: (r) => formatDate(r.paidOn), total: "Total" },
        { key: "no", header: "Voucher no.", cell: (r) => r.paymentNo, mono: true },
        { key: "challan", header: "Challan no.", cell: (r) => r.challanNo, mono: true },
        {
          key: "party",
          header: "Party",
          cell: (r) => <Link href={partyHref(r.partyId)}>{r.partyName}</Link>,
          wrap: true,
        },
        { key: "pan", header: "PAN", cell: (r) => r.pan ?? "—", mono: true },
        { key: "pant", header: "PAN type", cell: (r) => r.panType ?? "—" },
        { key: "sec", header: "Section", cell: (r) => r.section ?? "—" },
        { key: "base", header: "TDS base ₹", cell: (r) => formatPaise(r.tdsBasePaise), align: "right" },
        { key: "pct", header: "TDS %", cell: (r) => pct(r.tdsPercent), align: "right" },
        { key: "tds", header: "TDS ₹", cell: (r) => formatPaise(r.tdsPaise), total: formatPaise(t.tdsPaise), align: "right" },
        { key: "net", header: "Net ₹", cell: (r) => formatPaise(r.netPaise), total: formatPaise(t.netPaise), align: "right" },
        {
          key: "decl",
          header: "",
          cell: (r) => (r.declaration ? <Chip tone="green">Declaration 194C(6)</Chip> : ""),
        },
      ];
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.quarters.map((q) => (
              <Stat
                key={q.quarter}
                label={`${q.quarter} · ${q.n} ${q.n === 1 ? "entry" : "entries"}`}
                value={`TDS ₹ ${formatPaise(q.tdsPaise)}`}
              />
            ))}
          </div>
          <ReportCard
            label="TDS register"
            columns={cols}
            page={data.page}
            rowKey={(r) => r.allocationId}
            noun={["entry", "entries"]}
            hrefFor={href}
            empty={none}
          />
        </>
      );
    }

    case "margin": {
      const t = data.page.totals;
      const cols: Col<TripMarginRow>[] = [
        { key: "no", header: "Challan no.", cell: (r) => <Link href={`/market-trucks/challans/${r.id}`}>{r.challanNo}</Link>, mono: true, total: `Total (${data.page.total})` },
        { key: "date", header: "Date", cell: (r) => formatDate(r.challanDate) },
        { key: "branch", header: "Branch", cell: (r) => r.branchName },
        { key: "veh", header: "Vehicle", cell: (r) => r.vehicleNo ?? "—", mono: true },
        { key: "vt", header: "Vehicle type", cell: (r) => r.vehicleType ?? "—" },
        { key: "route", header: "Route", cell: (r) => route(r.source, r.destination), wrap: true },
        { key: "rev", header: "Party freight ₹", cell: (r) => formatPaise(r.revenuePaise), total: formatPaise(t.revenuePaise), align: "right" },
        {
          key: "cost",
          header: "Hire + additions − deductions ₹",
          cell: (r) => formatPaise(r.costPaise),
          total: formatPaise(t.costPaise),
          align: "right",
        },
        {
          key: "margin",
          header: "Margin ₹",
          cell: (r) => (r.low ? <Chip tone="red">{formatPaise(r.marginPaise)}</Chip> : formatPaise(r.marginPaise)),
          total: formatPaise(t.marginPaise),
          align: "right",
        },
        {
          key: "pct",
          header: "Margin %",
          cell: (r) => (r.low ? <Chip tone="red">{pct(r.marginPct)}</Chip> : pct(r.marginPct)),
          total: pct(t.marginPct),
          align: "right",
        },
      ];
      return (
        <>
          <p className="text-sm text-muted">
            Red = margin below {t.minMarginPct}% (company low-margin setting). {t.lowCount} of {data.page.total}{" "}
            {data.page.total === 1 ? "trip is" : "trips are"} low.
          </p>
          <ReportCard
            label="Trip margin"
            columns={cols}
            page={data.page}
            rowKey={(r) => r.id}
            noun={["challan", "challans"]}
            hrefFor={href}
            empty={none}
          />
        </>
      );
    }

    case "lanes": {
      const rate = (r: LaneRateRow, p: number) =>
        r.rateBasis === "per_tonne" ? `${formatPaise(p)} /t` : formatPaise(p);
      const cols: Col<LaneRateRow>[] = [
        { key: "from", header: "From", cell: (r) => r.source, wrap: true, total: `Total (${data.page.total} lanes)` },
        { key: "to", header: "To", cell: (r) => r.destination, wrap: true },
        { key: "vt", header: "Vehicle type", cell: (r) => r.vehicleType ?? "—" },
        { key: "basis", header: "Rate basis", cell: (r) => (r.rateBasis === "per_tonne" ? "Per tonne" : "Per trip") },
        { key: "trips", header: "Trips", cell: (r) => r.trips, total: data.page.totals.trips, align: "right" },
        { key: "min", header: "Min ₹ (trip) / ₹/t", cell: (r) => rate(r, r.minPaise), align: "right" },
        { key: "avg", header: "Avg ₹ (trip) / ₹/t", cell: (r) => rate(r, r.avgPaise), align: "right" },
        { key: "max", header: "Max ₹ (trip) / ₹/t", cell: (r) => rate(r, r.maxPaise), align: "right" },
        { key: "last", header: "Last ₹ (trip) / ₹/t", cell: (r) => rate(r, r.lastPaise), align: "right" },
        { key: "lastd", header: "Last date", cell: (r) => formatDate(r.lastDate) },
      ];
      return (
        <ReportCard
          label="Lane rates"
          columns={cols}
          page={data.page}
          rowKey={(r) => r.key}
          noun={["lane", "lanes"]}
          hrefFor={href}
          empty={none}
        />
      );
    }
  }
}

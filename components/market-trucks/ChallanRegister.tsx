import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import type { ChallanRegisterRow } from "@/lib/data/db/challans";
import { formatDate, formatPaise } from "@/lib/format";
import type { ChallanStatus, Page, TripEventType } from "@/lib/types";
import {
  challanListSearch,
  hasChallanFilters,
  type ChallanListQuery,
} from "@/lib/validators/challan-list";
import { ChallanFilters } from "./ChallanFilters";
import { TRIP_LABEL, TRIP_TONE } from "./trip-labels";

const BASE = "/market-trucks/challans";

const STATUS_TONE: Record<ChallanStatus, ChipTone> = {
  draft: "amber",
  dispatched: "blue",
  in_transit: "blue",
  reached: "blue",
  pod_received: "green",
  settled: "grey",
};


/** Latest trip event type per challan; supplied by the register query when it joins trip_events. */
type Row = ChallanRegisterRow & { latestTripEvent?: TripEventType | null };

const columns: Column<Row>[] = [
  { key: "no", header: "Challan no.", cell: (r) => r.challanNo, mono: true, sticky: true },
  { key: "date", header: "Date", cell: (r) => formatDate(r.challanDate) },
  { key: "vehicle", header: "Vehicle", cell: (r) => r.vehicleNo ?? "—", mono: true },
  {
    key: "route",
    header: "Route",
    cell: (r) => (r.source || r.destination ? `${r.source ?? "—"} → ${r.destination ?? "—"}` : "—"),
    wrap: true,
  },
  { key: "payee", header: "Payee", cell: (r) => r.payeeName ?? "—", wrap: true },
  { key: "hire", header: "Hire ₹", cell: (r) => formatPaise(r.hirePaise), align: "right" },
  { key: "paid", header: "Paid ₹", cell: (r) => formatPaise(r.paidPaise), align: "right" },
  { key: "balance", header: "Balance ₹", cell: (r) => formatPaise(r.balancePaise), align: "right" },
  {
    key: "status",
    header: "Status",
    cell: (r) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Chip tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</Chip>
        {r.latestTripEvent && (
          <Chip tone={TRIP_TONE[r.latestTripEvent]}>{TRIP_LABEL[r.latestTripEvent]}</Chip>
        )}
      </span>
    ),
  },
  {
    key: "pod",
    header: "POD age",
    cell: (r) =>
      r.podAgeDays === null ? (
        ""
      ) : (
        <span className={r.podReceived ? "text-muted" : undefined}>
          {r.podAgeDays} {r.podAgeDays === 1 ? "day" : "days"}
        </span>
      ),
    align: "right",
  },
  {
    key: "actions",
    header: "",
    align: "right",
    cell: (r) => (
      <div className="relative z-10 flex justify-end gap-2">
        <Button href={`${BASE}/${r.id}`} variant="secondary" className="px-3">
          Open
        </Button>
        <Button href={`/pdf/challan/${r.id}`} newTab variant="secondary" className="px-3">
          Print PDF
        </Button>
        <Button href={`/market-trucks/payments/new?challanId=${r.id}`} variant="secondary" className="px-3">
          Pay
        </Button>
        <Button href={`${BASE}/${r.id}#pod`} variant="secondary" className="px-3">
          POD
        </Button>
      </div>
    ),
  },
];

function emptyText(query: ChallanListQuery, page: Page<unknown>) {
  if (page.total > 0) {
    return (
      <>
        Page {page.page} is past the end.{" "}
        <Link href={`${BASE}${challanListSearch({ ...query, page: 1 })}`}>Go to page 1</Link>
      </>
    );
  }
  if (hasChallanFilters(query)) {
    return (
      <>
        No challan matches these filters. <Link href={BASE}>Clear filters</Link>
      </>
    );
  }
  return "No challans yet. Use + New challan.";
}

/** Filters + table for /market-trucks/challans. */
export function ChallanRegister({
  query,
  page,
  branches,
  loading,
}: {
  query: ChallanListQuery;
  page?: Page<ChallanRegisterRow>;
  branches: { id: string; name: string }[];
  loading?: boolean;
}) {
  const data = page ?? { rows: [], total: 0, page: 1, pageSize: 50 };
  return (
    <>
      <ChallanFilters filters={query} branches={branches} disabled={loading} />
      <Card padding="table">
        <DataTable
          label="Challans"
          columns={columns}
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={loading ? "Loading…" : emptyText(query, data)}
        />
        {!loading && (
          <div className="mx-3 mt-4">
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              noun={data.total === 1 ? "challan" : "challans"}
              hrefFor={(p) => `${BASE}${challanListSearch({ ...query, page: p })}`}
            />
          </div>
        )}
      </Card>
    </>
  );
}

export function ChallanRegisterSkeleton() {
  return <ChallanRegister query={{ page: 1 }} branches={[]} loading />;
}

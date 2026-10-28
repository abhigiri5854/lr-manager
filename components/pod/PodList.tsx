import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import type { PodPendingItem } from "@/lib/data/pod";
import { formatDate, formatRupees } from "@/lib/format";
import type { LrView, Page } from "@/lib/types";
import { hasPodFilters, podListSearch, type PodListQuery } from "@/lib/validators/pod-list";
import { PodFilters } from "./PodFilters";
import { IfCan } from "@/components/ui/Permissions";

const pendingColumns = (penaltyShown: boolean): Column<PodPendingItem>[] => [
  { key: "lrNo", header: "LR no", cell: (r) => r.lrNo, mono: true },
  { key: "deliveredOn", header: "Delivered on", cell: (r) => formatDate(r.deliveredOn) },
  { key: "consignee", header: "Consignee", cell: (r) => r.consignee || "—", wrap: true },
  {
    key: "days",
    header: "Days since delivery",
    cell: (r) => (
      <span className="inline-flex items-center gap-2">
        {r.daysSinceDelivery}
        {r.overdue && (
          <Chip tone="amber" className="px-2 py-0.5">
            Overdue
          </Chip>
        )}
      </span>
    ),
  },
  ...(penaltyShown
    ? [
        {
          key: "penalty",
          header: "Penalty so far",
          cell: (r: PodPendingItem) => (r.penaltyPaise > 0 ? formatRupees(r.penaltyPaise) : "—"),
          align: "right" as const,
        },
      ]
    : []),
];

const transitColumns: Column<LrView>[] = [
  { key: "lrNo", header: "LR no", cell: (r) => r.lrNo ?? "—", mono: true },
  { key: "lrDate", header: "LR date", cell: (r) => (r.lrDate ? formatDate(r.lrDate) : "—") },
  { key: "consignee", header: "Consignee", cell: (r) => r.consigneeName ?? "—", wrap: true },
  { key: "truck", header: "Truck", cell: (r) => r.truckNumber ?? "—", mono: true },
  {
    key: "action",
    header: <span className="sr-only">Action</span>,
    align: "right",
    cell: (r) => (
      <IfCan action="pod.upload">
        <Button variant="outline" href={`/lr/${r.id}/pod`} className="relative z-10">
          Mark delivered
        </Button>
      </IfCan>
    ),
  },
];

const TABS = [
  { id: "pending", label: "POD pending" },
  { id: "transit", label: "In transit" },
] as const;

function Tabs({ query }: { query: PodListQuery }) {
  return (
    <nav aria-label="POD views" className="flex gap-2">
      {TABS.map((t) => {
        const current = query.tab === t.id;
        return (
          <Link
            key={t.id}
            href={`/pod${podListSearch({ tab: t.id })}`}
            aria-current={current ? "page" : undefined}
            className={
              current
                ? "inline-flex h-control items-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:text-white"
                : "inline-flex h-control items-center rounded-full border border-border-input bg-surface px-5 text-sm font-semibold text-text hover:bg-page hover:text-text"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function emptyText(query: PodListQuery, page: Page<unknown>) {
  if (page.total > 0) {
    return (
      <>
        Page {page.page} is past the end.{" "}
        <Link href={`/pod${podListSearch({ ...query, page: 1 })}`}>Go to page 1</Link>
      </>
    );
  }
  if (hasPodFilters(query)) {
    return (
      <>
        Nothing matches these filters.{" "}
        <Link href={`/pod${podListSearch({ tab: query.tab })}`}>Clear filters</Link>
      </>
    );
  }
  return query.tab === "transit" ? "No LRs in transit." : "No LRs waiting for POD.";
}

const NO_ROWS = { rows: [], total: 0, page: 1, pageSize: 50 };

/** Tabs + filters + table for /pod; pass the page for the current tab. */
export function PodList({
  query,
  pending,
  transit,
  showPenalty,
  loading,
}: {
  query: PodListQuery;
  pending?: Page<PodPendingItem>;
  transit?: Page<LrView>;
  showPenalty: boolean;
  loading?: boolean;
}) {
  const inTransit = query.tab === "transit";
  const page = (inTransit ? transit : pending) ?? NO_ROWS;
  const empty = loading ? "Loading…" : emptyText(query, page);
  return (
    <>
      <Tabs query={query} />
      <PodFilters query={query} disabled={loading} />
      <Card padding="table">
        {inTransit ? (
          <DataTable
            label="LRs in transit"
            columns={transitColumns}
            rows={page.rows as LrView[]}
            rowKey={(r) => r.id}
            rowHref={(r) => `/lr/${r.id}/pod`}
            empty={empty}
          />
        ) : (
          <DataTable
            label="LRs waiting for POD"
            columns={pendingColumns(showPenalty)}
            rows={page.rows as PodPendingItem[]}
            rowKey={(r) => r.lrId}
            rowHref={(r) => `/lr/${r.lrId}/pod`}
            rowTone={(r) => (r.overdue ? "warning" : undefined)}
            empty={empty}
          />
        )}
        {!loading && (
          <div className="mx-3 mt-4">
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              noun={page.total === 1 ? "LR" : "LRs"}
              hrefFor={(p) => `/pod${podListSearch({ ...query, page: p })}`}
            />
          </div>
        )}
      </Card>
    </>
  );
}

/** Loading state: tabs, filters and an empty table. */
export function PodListSkeleton() {
  return <PodList query={{ tab: "pending", page: 1 }} showPenalty loading />;
}

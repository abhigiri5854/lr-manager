import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import type { MarketDriver, Page } from "@/lib/types";
import {
  hasMarketListFilters,
  marketListSearch,
  type MarketListQuery,
} from "@/lib/validators/market-list";
import { EditMarketDriverButton } from "./EditMarketDriverButton";
import { ExpiryDate } from "./ExpiryDate";
import { MarketSearch } from "./MarketSearch";

const BASE = "/market-trucks/drivers";

const makeColumns = (canEdit: boolean): Column<MarketDriver>[] => [
  { key: "name", header: "Name", cell: (r) => r.name, wrap: true, sticky: true },
  { key: "mobile", header: "Mobile", cell: (r) => r.mobile ?? "—" },
  { key: "dl", header: "Licence no.", cell: (r) => r.dlNo ?? "—", mono: true },
  { key: "dlUpto", header: "Licence valid upto", cell: (r) => <ExpiryDate date={r.dlUpto} /> },
  {
    key: "file",
    header: "Licence copy",
    cell: (r) =>
      r.dlFileUrl ? (
        <a href={r.dlFileUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
          View
        </a>
      ) : (
        "—"
      ),
  },
  { key: "edit", header: "", cell: (r) => <EditMarketDriverButton driver={r} canEdit={canEdit} />, align: "right" },
];

function emptyText(query: MarketListQuery, page: Page<unknown>) {
  if (page.total > 0) {
    return (
      <>
        Page {page.page} is past the end.{" "}
        <Link href={`${BASE}${marketListSearch({ ...query, page: 1 })}`}>Go to page 1</Link>
      </>
    );
  }
  if (hasMarketListFilters(query)) {
    return (
      <>
        No driver matches &ldquo;{query.q}&rdquo;. <Link href={BASE}>Clear search</Link>
      </>
    );
  }
  return "No drivers yet. Use + Add driver.";
}

/** Search + table for /market-trucks/drivers. */
export function MarketDriverList({
  query,
  page,
  loading,
  canEdit = false,
}: {
  query: MarketListQuery;
  page?: Page<MarketDriver>;
  loading?: boolean;
  /** master.edit — shows the app-link buttons in the edit dialog. */
  canEdit?: boolean;
}) {
  const data = page ?? { rows: [], total: 0, page: 1, pageSize: 50 };
  return (
    <>
      <MarketSearch
        query={query}
        label="Search market drivers"
        placeholder="Name, mobile or licence number"
        disabled={loading}
      />
      <Card padding="table">
        <DataTable
          label="Market drivers"
          columns={makeColumns(canEdit)}
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
              noun={data.total === 1 ? "driver" : "drivers"}
              hrefFor={(p) => `${BASE}${marketListSearch({ ...query, page: p })}`}
            />
          </div>
        )}
      </Card>
    </>
  );
}

export function MarketDriverListSkeleton() {
  return <MarketDriverList query={{ page: 1 }} loading />;
}

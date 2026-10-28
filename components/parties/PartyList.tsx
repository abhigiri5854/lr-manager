import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import type { PartyStats } from "@/lib/data/parties";
import { formatDate, formatRupees } from "@/lib/format";
import type { Page, Party } from "@/lib/types";
import { hasPartyFilters, partyListSearch, type PartyListQuery } from "@/lib/validators/party-list";
import { PartyFilters } from "./PartyFilters";

export type PartyRow = Party & PartyStats;

const columns: Column<PartyRow>[] = [
  {
    key: "name",
    header: "Party",
    cell: (r) => (r.place ? `${r.name} – ${r.place}` : r.name),
    wrap: true,
    sticky: true,
  },
  {
    key: "gstin",
    header: "GSTIN",
    cell: (r) => r.gstin ?? <Chip tone="amber">Unregistered</Chip>,
    mono: true,
  },
  { key: "phone", header: "Phone", cell: (r) => r.phone ?? "—" },
  { key: "lrs", header: "LRs", cell: (r) => r.lrCount, align: "right" },
  {
    key: "last",
    header: "Last LR",
    cell: (r) => (r.lastLrDate ? formatDate(r.lastLrDate) : "—"),
  },
  {
    key: "outstanding",
    header: "Outstanding",
    cell: (r) => formatRupees(r.outstandingPaise),
    align: "right",
  },
];

function emptyText(query: PartyListQuery, page: Page<unknown>) {
  if (page.total > 0) {
    return (
      <>
        Page {page.page} is past the end.{" "}
        <Link href={`/parties${partyListSearch({ ...query, page: 1 })}`}>Go to page 1</Link>
      </>
    );
  }
  if (hasPartyFilters(query)) {
    return (
      <>
        No party matches &ldquo;{query.q}&rdquo;. <Link href="/parties">Clear search</Link>
      </>
    );
  }
  return "No parties yet. Use + Add party, or they are added when you save an LR.";
}

/** Search + table for /parties. */
export function PartyList({
  query,
  page,
  loading,
}: {
  query: PartyListQuery;
  page?: Page<PartyRow>;
  loading?: boolean;
}) {
  const data = page ?? { rows: [], total: 0, page: 1, pageSize: 50 };
  return (
    <>
      <PartyFilters query={query} disabled={loading} />
      <Card padding="table">
        <DataTable
          label="Parties"
          columns={columns}
          rows={data.rows}
          rowKey={(r) => r.id}
          rowHref={(r) => `/parties/${r.id}`}
          empty={loading ? "Loading…" : emptyText(query, data)}
        />
        {!loading && (
          <div className="mx-3 mt-4">
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              noun={data.total === 1 ? "party" : "parties"}
              hrefFor={(p) => `/parties${partyListSearch({ ...query, page: p })}`}
            />
          </div>
        )}
      </Card>
    </>
  );
}

export function PartyListSkeleton() {
  return <PartyList query={{ page: 1 }} loading />;
}

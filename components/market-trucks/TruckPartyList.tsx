import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import type { TruckPartyRow } from "@/lib/data/truck-parties";
import type { Page } from "@/lib/types";
import {
  hasTruckPartyFilters,
  truckPartyListSearch,
  type TruckPartyListQuery,
} from "@/lib/validators/truck-party-list";
import { EditTruckPartyButton } from "./EditTruckPartyButton";
import { TruckPartyFilters } from "./TruckPartyFilters";
import { truckPartyRoleLabel } from "./labels";

const BASE = "/market-trucks/parties";

const columns: Column<TruckPartyRow>[] = [
  { key: "name", header: "Name", cell: (r) => r.name, wrap: true, sticky: true },
  { key: "role", header: "Role", cell: (r) => truckPartyRoleLabel[r.role] },
  { key: "mobile", header: "Mobile", cell: (r) => r.mobile ?? "—" },
  { key: "pan", header: "PAN", cell: (r) => r.pan ?? "—", mono: true },
  {
    key: "pay",
    header: "Pay by",
    cell: (r) =>
      [r.accountNo && "Bank", r.upiId && "UPI"].filter(Boolean).join(" · ") || (
        <Chip tone="amber">No bank / UPI</Chip>
      ),
  },
  { key: "tds", header: "Latest TDS decl.", cell: (r) => r.latestTdsFy ?? "—" },
  {
    key: "status",
    header: "Status",
    cell: (r) =>
      r.status === "blacklisted" ? (
        <Chip tone="amber">Blacklisted</Chip>
      ) : r.verified ? (
        "Verified"
      ) : (
        <Chip tone="amber">Unverified</Chip>
      ),
  },
  { key: "edit", header: "", cell: (r) => <EditTruckPartyButton party={r} />, align: "right" },
];

function emptyText(query: TruckPartyListQuery, page: Page<unknown>) {
  if (page.total > 0) {
    return (
      <>
        Page {page.page} is past the end.{" "}
        <Link href={`${BASE}${truckPartyListSearch({ ...query, page: 1 })}`}>Go to page 1</Link>
      </>
    );
  }
  if (hasTruckPartyFilters(query)) {
    return (
      <>
        No truck party matches &ldquo;{query.q}&rdquo;. <Link href={BASE}>Clear search</Link>
      </>
    );
  }
  return "No truck parties yet. Use + Add truck party.";
}

/** Search + table for /market-trucks/parties. */
export function TruckPartyList({
  query,
  page,
  loading,
}: {
  query: TruckPartyListQuery;
  page?: Page<TruckPartyRow>;
  loading?: boolean;
}) {
  const data = page ?? { rows: [], total: 0, page: 1, pageSize: 50 };
  return (
    <>
      <TruckPartyFilters query={query} disabled={loading} />
      <Card padding="table">
        <DataTable
          label="Truck parties"
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
              noun={data.total === 1 ? "truck party" : "truck parties"}
              hrefFor={(p) => `${BASE}${truckPartyListSearch({ ...query, page: p })}`}
            />
          </div>
        )}
      </Card>
    </>
  );
}

export function TruckPartyListSkeleton() {
  return <TruckPartyList query={{ page: 1 }} loading />;
}

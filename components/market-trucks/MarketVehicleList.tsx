import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import type { MarketVehicleRow } from "@/lib/data/market-vehicles";
import type { Page } from "@/lib/types";
import {
  hasMarketListFilters,
  marketListSearch,
  type MarketListQuery,
} from "@/lib/validators/market-list";
import { EditMarketVehicleButton } from "./EditMarketVehicleButton";
import { ExpiryDate } from "./ExpiryDate";
import { MarketSearch } from "./MarketSearch";

const BASE = "/market-trucks/vehicles";

const columns: Column<MarketVehicleRow>[] = [
  { key: "no", header: "Vehicle no.", cell: (r) => r.vehicleNo, mono: true, sticky: true },
  { key: "owner", header: "Owner", cell: (r) => r.ownerName ?? "—", wrap: true },
  { key: "type", header: "Type", cell: (r) => r.vehicleTypeName ?? "—" },
  {
    key: "capacity",
    header: "Capacity",
    cell: (r) => (r.capacityKg ? `${r.capacityKg.toLocaleString("en-IN")} kg` : "—"),
  },
  { key: "rcOwner", header: "RC owner", cell: (r) => r.rcOwnerName ?? "—", wrap: true },
  { key: "insurance", header: "Insurance", cell: (r) => <ExpiryDate date={r.insuranceUpto} /> },
  { key: "fitness", header: "Fitness", cell: (r) => <ExpiryDate date={r.fitnessUpto} /> },
  { key: "permit", header: "Permit", cell: (r) => <ExpiryDate date={r.permitUpto} /> },
  { key: "puc", header: "PUC", cell: (r) => <ExpiryDate date={r.pucUpto} /> },
  {
    key: "rc",
    header: "RC",
    cell: (r) =>
      r.rcFileUrl ? (
        <a href={r.rcFileUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
          View
        </a>
      ) : (
        "—"
      ),
  },
  { key: "edit", header: "", cell: (r) => <EditMarketVehicleButton vehicle={r} />, align: "right" },
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
        No vehicle matches &ldquo;{query.q}&rdquo;. <Link href={BASE}>Clear search</Link>
      </>
    );
  }
  return "No vehicles yet. Use + Add vehicle.";
}

/** Search + table for /market-trucks/vehicles. */
export function MarketVehicleList({
  query,
  page,
  loading,
}: {
  query: MarketListQuery;
  page?: Page<MarketVehicleRow>;
  loading?: boolean;
}) {
  const data = page ?? { rows: [], total: 0, page: 1, pageSize: 50 };
  return (
    <>
      <MarketSearch
        query={query}
        label="Search market vehicles"
        placeholder="Vehicle number, owner or RC owner"
        disabled={loading}
      />
      <Card padding="table">
        <DataTable
          label="Market vehicles"
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
              noun={data.total === 1 ? "vehicle" : "vehicles"}
              hrefFor={(p) => `${BASE}${marketListSearch({ ...query, page: p })}`}
            />
          </div>
        )}
      </Card>
    </>
  );
}

export function MarketVehicleListSkeleton() {
  return <MarketVehicleList query={{ page: 1 }} loading />;
}

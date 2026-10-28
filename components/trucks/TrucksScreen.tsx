import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import type { DriverRow, IsoDate, Page, TruckRow } from "@/lib/types";
import { truckListSearch, type TruckListQuery } from "@/lib/validators/truck-list";
import { DriverList } from "./DriverList";
import { TruckFilters } from "./TruckFilters";
import { TruckList } from "./TruckList";
import type { DriverOption } from "./TruckForm";

const empty = { rows: [], total: 0, page: 1, pageSize: 50 };

function emptyText(
  noun: string,
  query: TruckListQuery,
  page: Page<unknown>,
  pageParam: "tp" | "dp",
) {
  if (page.total > 0) {
    return (
      <>
        Page {page.page} is past the end.{" "}
        <Link href={`/trucks${truckListSearch({ ...query, [pageParam]: 1 })}`}>Go to page 1</Link>
      </>
    );
  }
  if (query.q) {
    return (
      <>
        No {noun} matches &ldquo;{query.q}&rdquo;. <Link href="/trucks">Clear search</Link>
      </>
    );
  }
  return noun === "truck"
    ? "No trucks yet. Use + Add truck, or they are added when you save an LR."
    : "No drivers yet. Use + Add driver.";
}

/** Search + the Trucks and Drivers tables for /trucks. */
export function TrucksScreen({
  query,
  trucks,
  drivers,
  driverOptions = [],
  today,
  loading,
}: {
  query: TruckListQuery;
  trucks?: Page<TruckRow>;
  drivers?: Page<DriverRow>;
  driverOptions?: DriverOption[];
  today: IsoDate;
  loading?: boolean;
}) {
  const t = trucks ?? empty;
  const d = drivers ?? empty;
  return (
    <>
      <TruckFilters query={query} disabled={loading} />
      <Card title="Trucks" padding="table">
        <TruckList
          rows={t.rows}
          driverOptions={driverOptions}
          today={today}
          empty={loading ? "Loading…" : emptyText("truck", query, t, "tp")}
        />
        {!loading && (
          <div className="mx-3 mt-4">
            <Pagination
              page={t.page}
              pageSize={t.pageSize}
              total={t.total}
              noun={t.total === 1 ? "truck" : "trucks"}
              hrefFor={(p) => `/trucks${truckListSearch({ ...query, tp: p })}`}
            />
            <p className="mt-3 mb-0 text-[13px] text-muted">
              Document expiry dates feed the Dashboard alerts 15 days before they lapse.
            </p>
          </div>
        )}
      </Card>
      <Card title="Drivers" padding="table">
        <DriverList
          rows={d.rows}
          today={today}
          empty={loading ? "Loading…" : emptyText("driver", query, d, "dp")}
        />
        {!loading && (
          <div className="mx-3 mt-4">
            <Pagination
              page={d.page}
              pageSize={d.pageSize}
              total={d.total}
              noun={d.total === 1 ? "driver" : "drivers"}
              hrefFor={(p) => `/trucks${truckListSearch({ ...query, dp: p })}`}
            />
            <p className="mt-3 mb-0 text-[13px] text-muted">
              &ldquo;Invite to driver app&rdquo; only records the invite for now; no SMS is sent
              yet.
            </p>
          </div>
        )}
      </Card>
    </>
  );
}

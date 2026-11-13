import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import type { EwbRow } from "@/lib/data/ewb";
import { formatDateTime } from "@/lib/driver-app/format";
import type { Page } from "@/lib/types";
import { EWB_WHEN, ewbListSearch, type EwbListQuery } from "@/lib/validators/ewb-list";
import { cx } from "@/lib/cx";

const BASE = "/market-trucks/eway";

const columns: Column<EwbRow>[] = [
  { key: "lr", header: "LR", cell: (r) => r.lrNo, mono: true, sticky: true },
  {
    key: "challan",
    header: "Challan",
    cell: (r) => (
      <Link href={`/market-trucks/challans/${r.challanId}`} className="font-mono text-primary">
        {r.challanNo}
      </Link>
    ),
  },
  { key: "vehicle", header: "Vehicle", cell: (r) => r.vehicleNo ?? "—", mono: true },
  {
    key: "route",
    header: "Route",
    cell: (r) => (r.source || r.destination ? `${r.source ?? "—"} → ${r.destination ?? "—"}` : "—"),
    wrap: true,
  },
  { key: "ewb", header: "E-way no.", cell: (r) => r.ewbNo, mono: true },
  { key: "expiry", header: "Expiry", cell: (r) => (r.validUpto ? formatDateTime(r.validUpto) : "—") },
  {
    key: "source",
    header: "Source",
    cell: (r) =>
      r.expirySource ? (
        <Chip tone={r.expirySource === "entered" ? "blue" : "grey"}>
          {r.expirySource === "entered" ? "Entered" : "Computed"}
        </Chip>
      ) : (
        <span className="text-muted">No expiry</span>
      ),
  },
  {
    key: "left",
    header: "Time left",
    align: "right",
    cell: (r) =>
      r.timeLeft === null ? (
        ""
      ) : (
        <span
          className={cx(
            r.bucket === "expired" && "font-semibold text-danger",
            (r.bucket === "under6h" || r.bucket === "under24h") && "font-semibold text-warning",
          )}
        >
          {r.timeLeft}
        </span>
      ),
  },
];

export function EwayRegister({ query, page }: { query: EwbListQuery; page: Page<EwbRow> }) {
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by time left">
        {EWB_WHEN.map((o) => (
          <Button
            key={o.value}
            href={`${BASE}${ewbListSearch({ when: o.value })}`}
            variant={query.when === o.value ? "primary" : "secondary"}
            className="px-3"
          >
            {o.label}
          </Button>
        ))}
      </div>
      <Card padding="table">
        <DataTable
          label="E-way bills"
          columns={columns}
          rows={page.rows}
          rowKey={(r) => `${r.lineId}-${r.ewbNo}`}
          empty="No e-way bills on live challans match this filter."
        />
        <div className="mx-3 mt-4">
          <Pagination
            page={page.page}
            pageSize={page.pageSize}
            total={page.total}
            noun={page.total === 1 ? "e-way bill" : "e-way bills"}
            hrefFor={(p) => `${BASE}${ewbListSearch({ when: query.when, page: p })}`}
          />
        </div>
      </Card>
    </>
  );
}

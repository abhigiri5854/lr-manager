import type { ReactNode } from "react";
import { LrStatusChip } from "@/components/LrStatusChip";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate, formatPaise } from "@/lib/format";
import { paymentModeLabel } from "@/lib/labels";
import { ewayUrgency } from "@/lib/lr-status";
import type { LrView } from "@/lib/types";
import { LrActions } from "./LrActions";
import { LrParties } from "./LrParties";

const dash = (v: string | null) => v || "—";

/** Expiry date, plus an "Expired" / "≤24h" chip while goods are moving (not colour alone). */
function Eway({ lr, nowMs }: { lr: LrView; nowMs: number }) {
  if (!lr.ewayExpiresAt) return "—";
  const urgency = ewayUrgency(lr.status, lr.ewayExpiresAt, nowMs);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {formatDate(lr.ewayExpiresAt)}
      {urgency === "expired" && (
        <Chip tone="red" className="px-2 py-0.5">
          Expired
        </Chip>
      )}
      {urgency === "expiring" && (
        <Chip tone="amber" className="px-2 py-0.5">
          <span aria-hidden>≤24h</span>
          <span className="sr-only">expires within 24 hours</span>
        </Chip>
      )}
    </span>
  );
}

function columns(nowMs: number): Column<LrView>[] {
  return [
    {
      key: "lrNo",
      header: "LR No / Date",
      sticky: true,
      cell: (lr) => (
        <>
          <span className="block font-mono">{lr.lrNo}</span>
          <span className="block text-xs text-muted">
            {lr.lrDate ? formatDate(lr.lrDate) : "No date"}
          </span>
        </>
      ),
    },
    {
      key: "parties",
      header: "Parties",
      wrap: true,
      selfClamped: true,
      cell: (lr) => <LrParties lr={lr} />,
    },
    {
      key: "route",
      header: "Route / Truck",
      wrap: true,
      selfClamped: true,
      cell: (lr) => (
        <>
          <span className="line-clamp-2">
            {lr.fromPlace || lr.toPlace ? `${dash(lr.fromPlace)} → ${dash(lr.toPlace)}` : "—"}
          </span>
          <span className="block font-mono text-xs text-muted">{dash(lr.truckNumber)}</span>
        </>
      ),
    },
    { key: "pkgs", header: "Pkgs", cell: (lr) => lr.totalPackages || "—" },
    {
      key: "value",
      header: "Value ₹ / Pay",
      cell: (lr) => (
        <>
          <span className="block">
            {lr.totalValuePaise === null ? "—" : formatPaise(lr.totalValuePaise)}
          </span>
          <span className="block text-xs text-muted">
            {lr.paymentMode ? paymentModeLabel[lr.paymentMode] : "—"}
          </span>
        </>
      ),
    },
    { key: "eway", header: "E-way exp.", cell: (lr) => <Eway lr={lr} nowMs={nowMs} /> },
    { key: "status", header: "Status", cell: (lr) => <LrStatusChip status={lr.status} /> },
    { key: "actions", header: "Actions", cell: (lr) => <LrActions lr={lr} /> },
  ];
}

export function RegisterTable({
  lrs,
  nowMs,
  empty,
}: {
  lrs: LrView[];
  nowMs: number;
  empty: ReactNode;
}) {
  return (
    <DataTable
      label="LR register"
      columns={columns(nowMs)}
      rows={lrs}
      rowKey={(lr) => lr.id}
      rowHref={(lr) => `/lr/${lr.id}`}
      empty={empty}
      // 10px cells so all columns fit without scrolling from 1280px windows up.
      density="compact"
    />
  );
}

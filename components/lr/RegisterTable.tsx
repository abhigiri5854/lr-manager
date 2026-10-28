import Link from "next/link";
import type { ReactNode } from "react";
import { LrStatusChip } from "@/components/LrStatusChip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate, formatPaise } from "@/lib/format";
import { paymentModeLabel } from "@/lib/labels";
import { ewayUrgency } from "@/lib/lr-status";
import type { LrStatus, LrView } from "@/lib/types";
import { cx } from "@/lib/cx";

const dash = (v: string | null) => v || "—";

/** Links inside a clickable row sit above the row's overlay link. */
function RowLink({
  href,
  children,
  newTab,
}: {
  href: string;
  children: ReactNode;
  newTab?: boolean;
}) {
  return (
    <Link
      href={href}
      className="relative z-10"
      prefetch={newTab ? false : undefined}
      target={newTab ? "_blank" : undefined}
    >
      {children}
    </Link>
  );
}

function Eway({ lr, nowMs }: { lr: LrView; nowMs: number }) {
  if (!lr.ewayExpiresAt) return "—";
  const urgency = ewayUrgency(lr.status, lr.ewayExpiresAt, nowMs);
  const note =
    urgency === "expired" ? "expired" : urgency === "expiring" ? "expires within 24 h" : null;
  return (
    <span
      title={note ? `E-way bill ${note}` : undefined}
      className={cx(
        urgency && "font-semibold",
        urgency === "expired" && "text-danger",
        urgency === "expiring" && "text-warning",
      )}
    >
      {formatDate(lr.ewayExpiresAt)}
      {note && <span className="sr-only"> ({note})</span>}
    </span>
  );
}

/** Wrapped text cells stay wide enough to read; the table scrolls sideways instead. */
function Wide({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="block min-w-40" title={title}>
      {children}
    </span>
  );
}

/** Goods not yet handed over with a POD. */
const awaitingPod = (s: LrStatus) => s === "Booked" || s === "In transit" || s === "Delivered";

function Actions({ lr }: { lr: LrView }) {
  if (lr.status === "Draft") return <RowLink href={`/lr/${lr.id}/edit`}>Finish</RowLink>;
  const links = [
    lr.status !== "Cancelled" && (
      <RowLink key="print" href={`/pdf/lr/${lr.id}`} newTab>
        Print
      </RowLink>
    ),
    <RowLink key="repeat" href={`/lr/new?from=${lr.id}`}>
      Repeat
    </RowLink>,
    awaitingPod(lr.status) && (
      <RowLink key="pod" href={`/lr/${lr.id}/pod`}>
        Mark delivered / POD
      </RowLink>
    ),
  ].filter(Boolean);
  return links.flatMap((link, i) => (i ? [" · ", link] : [link]));
}

function columns(nowMs: number): Column<LrView>[] {
  return [
    { key: "lrNo", header: "LR No", mono: true, cell: (lr) => lr.lrNo },
    { key: "date", header: "Date", cell: (lr) => (lr.lrDate ? formatDate(lr.lrDate) : "—") },
    {
      key: "consignor",
      header: "Consignor",
      wrap: true,
      cell: (lr) => <Wide>{dash(lr.consignorName)}</Wide>,
    },
    {
      key: "consignee",
      header: "Consignee / billed to",
      wrap: true,
      cell: (lr) =>
        lr.billedToName && lr.billedToId !== lr.consigneeId ? (
          // One line each, so the "billed:" line is never cut off by a long consignee name.
          <Wide title={`${dash(lr.consigneeName)} · billed: ${lr.billedToName}`}>
            <span className="line-clamp-1">{dash(lr.consigneeName)}</span>
            <span className="line-clamp-1 text-xs text-muted">billed: {lr.billedToName}</span>
          </Wide>
        ) : (
          <Wide>{dash(lr.consigneeName)}</Wide>
        ),
    },
    {
      key: "route",
      header: "Route",
      wrap: true,
      cell: (lr) =>
        lr.fromPlace || lr.toPlace ? (
          <Wide>{`${dash(lr.fromPlace)} → ${dash(lr.toPlace)}`}</Wide>
        ) : (
          "—"
        ),
    },
    { key: "truck", header: "Truck", mono: true, cell: (lr) => dash(lr.truckNumber) },
    { key: "pkgs", header: "Pkgs", cell: (lr) => lr.totalPackages || "—" },
    {
      key: "value",
      header: "Value ₹",
      cell: (lr) => (lr.totalValuePaise === null ? "—" : formatPaise(lr.totalValuePaise)),
    },
    { key: "eway", header: "E-way exp.", cell: (lr) => <Eway lr={lr} nowMs={nowMs} /> },
    {
      key: "pay",
      header: "Pay",
      cell: (lr) => (lr.paymentMode ? paymentModeLabel[lr.paymentMode] : "—"),
    },
    { key: "status", header: "Status", cell: (lr) => <LrStatusChip status={lr.status} /> },
    { key: "actions", header: "Actions", cell: (lr) => <Actions lr={lr} /> },
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
    />
  );
}

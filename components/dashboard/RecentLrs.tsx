import Link from "next/link";
import type { ReactNode } from "react";
import { LrStatusChip } from "@/components/LrStatusChip";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate } from "@/lib/format";
import type { LrView } from "@/lib/types";

const dash = (v: string | null) => v ?? "—";

/** "A → B" as two lines (A, then → B), each cut with "…" when narrow; full text on hover. */
function TwoLine({ from, to }: { from: string | null; to: string | null }) {
  return (
    <span title={`${dash(from)} → ${dash(to)}`}>
      <span className="line-clamp-1">{dash(from)}</span>
      <span className="line-clamp-1">→ {dash(to)}</span>
    </span>
  );
}

const columns: Column<LrView>[] = [
  {
    key: "lrNo",
    header: "LR No",
    mono: true,
    cell: (lr) => <Link href={`/lr/${lr.id}`}>{lr.lrNo}</Link>,
  },
  { key: "date", header: "Date", cell: (lr) => (lr.lrDate ? formatDate(lr.lrDate) : "—") },
  {
    key: "parties",
    header: "Consignor → Consignee",
    wrap: true,
    cell: (lr) => <TwoLine from={lr.consignorName} to={lr.consigneeName} />,
  },
  {
    key: "route",
    header: "Route",
    wrap: true,
    cell: (lr) => <TwoLine from={lr.fromPlace} to={lr.toPlace} />,
  },
  { key: "truck", header: "Truck", mono: true, cell: (lr) => dash(lr.truckNumber) },
  {
    key: "status",
    header: "Status",
    cell: (lr) => (
      <LrStatusChip
        status={lr.status}
        note={
          lr.status === "Draft" && lr.lrInvoices.some((i) => i.taxInvoiceId)
            ? "from invoice"
            : undefined
        }
      />
    ),
  },
  {
    key: "actions",
    header: <span className="sr-only">Actions</span>,
    cell: (lr) =>
      lr.status === "Draft" ? (
        <Link href={`/lr/${lr.id}/edit`}>Finish</Link>
      ) : (
        <>
          <Link href={`/lr/${lr.id}`}>View</Link> ·{" "}
          <Link href={`/lr/new?from=${lr.id}`}>Repeat</Link>
        </>
      ),
  },
];

function RecentCard({ children }: { children: ReactNode }) {
  return (
    <Card
      heading="large"
      title="Recent consignment notes"
      action={<Link href="/lr">Open register</Link>}
      // Sits beside the aside only when it gets ≥ 840px (window ≥ ~1520px); narrower,
      // the aside drops below so names stay readable and no column scrolls off.
      className="min-w-0 flex-[999_1_840px]"
    >
      {children}
    </Card>
  );
}

export function RecentLrs({ lrs }: { lrs: LrView[] }) {
  return (
    <RecentCard>
      <DataTable
        label="Recent consignment notes"
        columns={columns}
        rows={lrs}
        rowKey={(lr) => lr.id}
        density="compact"
        empty={
          <>
            No consignment notes yet. <Link href="/lr/new">Create the first LR</Link> or{" "}
            <Link href="/import">import a booking report</Link>.
          </>
        }
      />
    </RecentCard>
  );
}

export function RecentLrsLoading() {
  return (
    <RecentCard>
      <DataTable
        label="Recent consignment notes"
        columns={columns}
        rows={[]}
        rowKey={() => ""}
        empty="Loading…"
      />
    </RecentCard>
  );
}

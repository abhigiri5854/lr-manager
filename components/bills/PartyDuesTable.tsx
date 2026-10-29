import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import type { PartyDues } from "@/lib/data/bill-reports";
import { formatDate, formatPaise } from "@/lib/format";

const columns: Column<PartyDues>[] = [
  {
    key: "party",
    header: "Party",
    cell: (r) => <Link href={`/bills/ledger/${r.partyId}`}>{r.name}</Link>,
    wrap: true,
  },
  { key: "unbilled", header: "Unbilled LRs", cell: (r) => r.unbilledLrs, align: "right" },
  { key: "billed", header: "Billed ₹", cell: (r) => formatPaise(r.billedPaise), align: "right" },
  {
    key: "received",
    header: "Received ₹",
    cell: (r) => formatPaise(r.receivedPaise),
    align: "right",
  },
  { key: "tds", header: "TDS ₹", cell: (r) => formatPaise(r.tdsPaise), align: "right" },
  {
    key: "outstanding",
    header: "Outstanding ₹",
    cell: (r) => <b>{formatPaise(r.outstandingPaise)}</b>,
    align: "right",
  },
  {
    key: "oldest",
    header: "Oldest due",
    cell: (r) => (r.oldestDueDate ? formatDate(r.oldestDueDate) : "—"),
  },
];

/** "Payments & dues by party" (Bills.dc.html). A party opens its ledger. */
export function PartyDuesTable({ rows }: { rows: PartyDues[] }) {
  return (
    <Card title="Payments & dues by party" padding="table">
      <DataTable
        label="Payments and dues by party"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.partyId}
        empty="No bills, payments or unbilled TBB LRs yet."
      />
      <p className="mx-3 mt-3 mb-0 text-[13px] text-muted">
        Click a party for its full ledger: bills, receipts, TDS, running balance — downloadable as
        Excel.
      </p>
    </Card>
  );
}

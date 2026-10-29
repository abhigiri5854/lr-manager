import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { billPaymentStatus } from "@/lib/bill-status";
import { formatDate, formatPaise } from "@/lib/format";
import type { FreightBillView, Page } from "@/lib/types";
import { billListSearch, hasBillFilters, type BillListQuery } from "@/lib/validators/bill-list";
import { BillFilters, type BillPartyOption } from "./BillFilters";
import { BillRowActions } from "./BillRowActions";
import { BillStatusChip } from "./BillStatusChip";

function columns(parties: BillPartyOption[]): Column<FreightBillView>[] {
  return [
    {
      key: "no",
      header: "Bill no.",
      cell: (r) => (r.billNo ? <b>{r.billNo}</b> : <span className="text-muted">Draft</span>),
      mono: true,
      sticky: true,
    },
    { key: "date", header: "Date", cell: (r) => formatDate(r.billDate) },
    { key: "party", header: "Party", cell: (r) => r.partyName, wrap: true },
    { key: "lrs", header: "LRs", cell: (r) => r.lrNos.join(", "), wrap: true, mono: true },
    {
      key: "amount",
      header: "Amount ₹",
      cell: (r) => <b>{formatPaise(r.totals.amountPaise)}</b>,
      align: "right",
    },
    {
      key: "received",
      header: "Received ₹",
      cell: (r) => (r.status === "final" ? formatPaise(r.receivedPaise) : "—"),
      align: "right",
    },
    {
      key: "due",
      header: "Due ₹",
      cell: (r) => (r.status === "final" && !r.cancelledAt ? formatPaise(r.duePaise) : "—"),
      align: "right",
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <BillStatusChip status={billPaymentStatus(r)} />,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (r) => (
        <BillRowActions
          bill={{
            id: r.id,
            billNo: r.billNo,
            partyId: r.partyId,
            status: billPaymentStatus(r),
          }}
          parties={parties}
        />
      ),
    },
  ];
}

function emptyText(query: BillListQuery, page: Page<unknown>, unbilled: string | null) {
  if (page.total > 0) {
    return (
      <>
        Page {page.page} is past the end.{" "}
        <Link href={`/bills${billListSearch({ ...query, page: 1 })}`}>Go to page 1</Link>
      </>
    );
  }
  if (hasBillFilters(query)) {
    return (
      <>
        No bill matches these filters. <Link href="/bills">Clear filters</Link>
      </>
    );
  }
  return (
    <>
      No freight bills yet.
      {unbilled && ` ${unbilled}`} Each bill row will let you record a payment or cancel it.
    </>
  );
}

/** Filters + table for the "Freight bills" card on /bills. */
export function BillList({
  query,
  page,
  parties,
  unbilledNote = null,
  loading,
}: {
  query: BillListQuery;
  page?: Page<FreightBillView>;
  parties: BillPartyOption[];
  /** Shown in the empty state, e.g. "3 TBB LRs are ready to bill." */
  unbilledNote?: string | null;
  loading?: boolean;
}) {
  const data = page ?? { rows: [], total: 0, page: 1, pageSize: 50 };
  return (
    <Card title="Freight bills" padding="table">
      <div className="mx-3 mt-3">
        <BillFilters query={query} parties={parties} disabled={loading} />
      </div>
      <DataTable
        label="Freight bills"
        columns={columns(parties)}
        rows={data.rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/bills/${r.id}`}
        empty={loading ? "Loading…" : emptyText(query, data, unbilledNote)}
      />
      {!loading && (
        <div className="mx-3 mt-4">
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            noun={data.total === 1 ? "bill" : "bills"}
            hrefFor={(p) => `/bills${billListSearch({ ...query, page: p })}`}
          />
        </div>
      )}
    </Card>
  );
}

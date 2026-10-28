import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { formatDate, formatPaise } from "@/lib/format";
import { todayInIndia } from "@/lib/fy";
import type { Page, TaxInvoiceRow } from "@/lib/types";
import {
  hasInvoiceFilters,
  invoiceListSearch,
  type InvoiceListQuery,
} from "@/lib/validators/invoice-list";
import { InvoiceFilters, type InvoicePartyOption } from "./InvoiceFilters";
import { InvoiceStatusChip } from "./InvoiceStatusChip";

const gst = (r: TaxInvoiceRow) => r.totals.sgstPaise + r.totals.cgstPaise + r.totals.igstPaise;

const columns: Column<TaxInvoiceRow>[] = [
  {
    key: "no",
    header: "Invoice no.",
    cell: (r) => (r.invoiceNo ? <b>{r.invoiceNo}</b> : <span className="text-muted">—</span>),
    mono: true,
    sticky: true,
  },
  { key: "date", header: "Date", cell: (r) => formatDate(todayInIndia(new Date(r.invoiceAt))) },
  { key: "billTo", header: "Bill to", cell: (r) => r.billToName, wrap: true },
  {
    key: "taxable",
    header: "Taxable ₹",
    cell: (r) => formatPaise(r.totals.taxablePaise),
    align: "right",
  },
  { key: "gst", header: "GST ₹", cell: (r) => formatPaise(gst(r)), align: "right" },
  {
    key: "total",
    header: "Total ₹",
    cell: (r) => <b>{formatPaise(r.totals.totalPaise)}</b>,
    align: "right",
  },
  {
    key: "lr",
    header: "Linked LR",
    cell: (r) =>
      r.linkedLrs.length
        ? r.linkedLrs.map((l, i) => (
            <span key={l.id}>
              {i > 0 && ", "}
              <Link href={`/lr/${l.id}`}>{l.lrNo}</Link>
            </span>
          ))
        : "—",
  },
  { key: "status", header: "Status", cell: (r) => <InvoiceStatusChip status={r.displayStatus} /> },
];

function emptyText(query: InvoiceListQuery, page: Page<unknown>) {
  if (page.total > 0) {
    return (
      <>
        Page {page.page} is past the end.{" "}
        <Link href={`/invoices${invoiceListSearch({ ...query, page: 1 })}`}>Go to page 1</Link>
      </>
    );
  }
  if (hasInvoiceFilters(query)) {
    return (
      <>
        No invoice matches these filters. <Link href="/invoices">Clear filters</Link>
      </>
    );
  }
  return "No tax invoices yet. Use + New invoice.";
}

/** Filters + table for /invoices. */
export function InvoiceList({
  query,
  page,
  parties,
  loading,
}: {
  query: InvoiceListQuery;
  page?: Page<TaxInvoiceRow>;
  parties: InvoicePartyOption[];
  loading?: boolean;
}) {
  const data = page ?? { rows: [], total: 0, page: 1, pageSize: 50 };
  return (
    <>
      <InvoiceFilters query={query} parties={parties} disabled={loading} />
      <Card padding="table">
        <DataTable
          label="Tax invoices"
          columns={columns}
          rows={data.rows}
          rowKey={(r) => r.id}
          rowHref={(r) => `/invoices/${r.id}`}
          empty={loading ? "Loading…" : emptyText(query, data)}
        />
        {!loading && (
          <div className="mx-3 mt-4">
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              noun={data.total === 1 ? "invoice" : "invoices"}
              hrefFor={(p) => `/invoices${invoiceListSearch({ ...query, page: p })}`}
            />
          </div>
        )}
      </Card>
    </>
  );
}

export function InvoiceListSkeleton() {
  return <InvoiceList query={{ page: 1 }} parties={[]} loading />;
}

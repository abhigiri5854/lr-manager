import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import type { TruckPaymentRow } from "@/lib/data/truck-payments";
import { formatDate, formatPaise } from "@/lib/format";
import { toPaise } from "@/lib/hire";
import type { Page, TruckPaymentStatus } from "@/lib/types";
import {
  hasTruckPaymentFilters,
  truckPaymentListSearch,
  type TruckPaymentListQuery,
} from "@/lib/validators/truck-payment-list";
import { PaymentFilters } from "./PaymentFilters";
import { PaymentActions } from "./PaymentRowActions";
import { paymentModeLabel, paymentStatusLabel } from "./labels";

const BASE = "/market-trucks/payments";

export const PAYMENT_STATUS_TONE: Record<TruckPaymentStatus, ChipTone> = {
  draft: "grey",
  pending_approval: "amber",
  approved: "blue",
  paid: "green",
  reversed: "red",
};

const rupees = (v: string) => formatPaise(toPaise(v));

function columns(today: string): Column<TruckPaymentRow>[] {
  return [
    {
      key: "no",
      header: "Voucher no.",
      cell: (r) => r.paymentNo ?? <span className="text-muted">Not approved yet</span>,
      mono: true,
      sticky: true,
    },
    { key: "date", header: "Date", cell: (r) => formatDate(r.paidOn) },
    { key: "payee", header: "Payee", cell: (r) => r.payeeName ?? "—", wrap: true },
    { key: "challans", header: "Challans", cell: (r) => r.challanNos.join(", ") || "—", wrap: true, mono: true },
    { key: "gross", header: "Gross ₹", cell: (r) => rupees(r.grossAmount), align: "right" },
    { key: "tds", header: "TDS ₹", cell: (r) => rupees(r.tdsAmount), align: "right" },
    { key: "net", header: "Net ₹", cell: (r) => rupees(r.amount), align: "right" },
    { key: "mode", header: "Mode", cell: (r) => paymentModeLabel[r.mode] },
    {
      key: "status",
      header: "Status",
      cell: (r) => <Chip tone={PAYMENT_STATUS_TONE[r.status]}>{paymentStatusLabel[r.status]}</Chip>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => <PaymentActions payment={r} today={today} />,
    },
  ];
}

function emptyText(query: TruckPaymentListQuery, page: Page<unknown>) {
  if (page.total > 0)
    return (
      <>
        Page {page.page} is past the end.{" "}
        <Link href={`${BASE}${truckPaymentListSearch({ ...query, page: 1 })}`}>Go to page 1</Link>
      </>
    );
  if (hasTruckPaymentFilters(query))
    return (
      <>
        No payment matches these filters. <Link href={BASE}>Clear filters</Link>
      </>
    );
  return "No payments yet. Payments are optional: use + New payment, or Pay on a challan, when you want to record one.";
}

/** Filters + table for /market-trucks/payments. */
export function PaymentRegister({
  query,
  page,
  today,
  loading,
}: {
  query: TruckPaymentListQuery;
  page?: Page<TruckPaymentRow>;
  today: string;
  loading?: boolean;
}) {
  const data = page ?? { rows: [], total: 0, page: 1, pageSize: 50 };
  return (
    <>
      <PaymentFilters filters={query} disabled={loading} />
      <Card padding="table">
        <DataTable
          label="Payments"
          columns={columns(today)}
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
              noun={data.total === 1 ? "payment" : "payments"}
              hrefFor={(p) => `${BASE}${truckPaymentListSearch({ ...query, page: p })}`}
            />
          </div>
        )}
      </Card>
    </>
  );
}

export function PaymentRegisterSkeleton() {
  return <PaymentRegister query={{ page: 1 }} today="" loading />;
}

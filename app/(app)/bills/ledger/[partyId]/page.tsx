import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LedgerPaymentActions } from "@/components/bills/BillRowActions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { KpiGrid, Kpi } from "@/components/dashboard/KpiCards";
import type { LedgerEntry } from "@/lib/data/bill-reports";
import { getPartyLedger } from "@/lib/data/bills";
import { getPartyById, listPartyOptions } from "@/lib/data/parties";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { formatDate, formatPaise, formatRupees } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Party ledger" };

const KIND_LABEL = { bill: "Bill", payment: "Payment", tds: "TDS" } as const;

async function LedgerLoader({ params }: Pick<PageProps<"/bills/ledger/[partyId]">, "params">) {
  const [{ partyId }, companyId, role] = await Promise.all([
    params,
    getActiveCompanyId(),
    getActiveRole(),
  ]);
  if (!can(role, "freight.view")) {
    return (
      <NoAccess
        title="Party ledger"
        role={role}
        action="freight.view"
        back={{ href: "/", label: "Open Dashboard" }}
      />
    );
  }
  const [party, ledger, parties] = await Promise.all([
    getPartyById(companyId, partyId),
    getPartyLedger(companyId, partyId),
    listPartyOptions(companyId),
  ]);
  if (!party) notFound();

  const columns: Column<LedgerEntry>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date) },
    { key: "type", header: "Type", cell: (r) => KIND_LABEL[r.kind] },
    {
      key: "ref",
      header: "Reference",
      cell: (r) =>
        r.billId ? <Link href={`/bills/${r.billId}`}>{r.ref}</Link> : r.ref,
      mono: true,
      wrap: true,
    },
    {
      key: "debit",
      header: "Billed ₹",
      cell: (r) => (r.debitPaise ? formatPaise(r.debitPaise) : ""),
      align: "right",
    },
    {
      key: "credit",
      header: "Received ₹",
      cell: (r) => (r.creditPaise ? formatPaise(r.creditPaise) : ""),
      align: "right",
    },
    {
      key: "balance",
      header: "Balance ₹",
      cell: (r) => <b>{formatPaise(r.runningPaise)}</b>,
      align: "right",
    },
    {
      key: "actions",
      header: "",
      cell: (r) =>
        r.kind === "payment" && r.paymentId ? (
          <div className="flex items-center gap-3">
            {r.onAccountPaise > 0 && (
              <span className="text-[13px] text-warning">
                {formatRupees(r.onAccountPaise)} on account
              </span>
            )}
            <LedgerPaymentActions
              paymentId={r.paymentId}
              parties={parties}
              onAccountPaise={r.onAccountPaise}
            />
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Bills & payments", href: "/bills" },
          { label: party.name },
        ]}
        breadcrumbPlacement="inline"
        title={`Ledger · ${party.name}`}
        subtitle="Bills, receipts and TDS with a running balance (billed minus received)."
        actions={
          <Button href={`/bills/ledger/${partyId}/export`} variant="secondary" download>
            Download Excel
          </Button>
        }
      />
      <KpiGrid>
        <Kpi label="Billed" value={formatRupees(ledger.billedPaise)} sub="final bills" />
        <Kpi label="Received" value={formatRupees(ledger.receivedPaise)} sub="cash, cheque, UPI" />
        <Kpi label="TDS" value={formatRupees(ledger.tdsPaise)} sub="deducted by the party" />
        <Kpi
          label="Outstanding"
          value={formatRupees(ledger.balancePaise)}
          sub={
            ledger.onAccountPaise > 0
              ? `${formatRupees(ledger.onAccountPaise)} received on account, not yet allocated`
              : "billed minus received"
          }
        />
      </KpiGrid>
      <Card title="Ledger" padding="table">
        <DataTable
          label="Party ledger"
          columns={columns}
          rows={ledger.entries}
          rowKey={(r) => r.key}
          empty="No final bills or payments for this party yet."
        />
      </Card>
    </>
  );
}

export default function LedgerPage({ params }: PageProps<"/bills/ledger/[partyId]">) {
  return (
    <div className="flex flex-col gap-5">
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-card" />}>
        <LedgerLoader params={params} />
      </Suspense>
    </div>
  );
}

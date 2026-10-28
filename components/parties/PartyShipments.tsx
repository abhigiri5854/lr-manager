import { LrStatusChip } from "@/components/LrStatusChip";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate, formatPaise } from "@/lib/format";
import type { LrView, Page, TaxInvoice } from "@/lib/types";

function roleOf(lr: LrView, partyId: string): string {
  return [
    lr.consignorId === partyId && "Consignor",
    lr.consigneeId === partyId && "Consignee",
    lr.billedToId === partyId && lr.billedToId !== lr.consigneeId && "Billed to",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Shipment history (LRs where the party is consignor, consignee or billed to) and goods invoices. */
export function PartyShipments({
  partyId,
  lrs,
  invoices,
}: {
  partyId: string;
  lrs: Page<LrView>;
  invoices: TaxInvoice[];
}) {
  const lrColumns: Column<LrView>[] = [
    { key: "lrNo", header: "LR no", cell: (r) => r.lrNo || "—", mono: true },
    { key: "date", header: "Date", cell: (r) => (r.lrDate ? formatDate(r.lrDate) : "—") },
    { key: "role", header: "Role", cell: (r) => roleOf(r, partyId) },
    { key: "consignee", header: "Consignee", cell: (r) => r.consigneeName ?? "—", wrap: true },
    {
      key: "invoice",
      header: "Invoice",
      cell: (r) => r.lrInvoices.map((i) => i.invoiceNo).join(", ") || "—",
      mono: true,
    },
    { key: "truck", header: "Truck", cell: (r) => r.truckNumber ?? "—", mono: true },
    {
      key: "value",
      header: "Value ₹",
      cell: (r) => (r.totalValuePaise === null ? "—" : formatPaise(r.totalValuePaise)),
      align: "right",
    },
    { key: "status", header: "Status", cell: (r) => <LrStatusChip status={r.status} /> },
  ];

  const invoiceColumns: Column<TaxInvoice>[] = [
    { key: "no", header: "Invoice", cell: (r) => r.invoiceNo, mono: true },
    { key: "date", header: "Date", cell: (r) => formatDate(r.invoiceAt) },
    {
      key: "role",
      header: "Role",
      cell: (r) =>
        [
          r.sellerPartyId === partyId && "Seller",
          r.billToId === partyId && "Bill to",
          r.shipToId === partyId && "Ship to",
        ]
          .filter(Boolean)
          .join(" · "),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <Chip tone={r.status === "final" ? "green" : "grey"}>
          {r.status === "final" ? "Final" : "Draft"}
        </Chip>
      ),
    },
    {
      key: "total",
      header: "Total ₹",
      cell: (r) => formatPaise(r.totals.totalPaise),
      align: "right",
    },
  ];

  return (
    <>
      <Card
        padding="table"
        title="Shipment history"
        action={
          lrs.total > lrs.rows.length ? `Latest ${lrs.rows.length} of ${lrs.total}` : undefined
        }
      >
        <DataTable
          label="Shipment history"
          columns={lrColumns}
          rows={lrs.rows}
          rowKey={(r) => r.id}
          rowHref={(r) => `/lr/${r.id}`}
          empty="No LRs for this party yet."
        />
      </Card>
      {invoices.length > 0 && (
        <Card padding="table" title="Goods invoices">
          <DataTable
            label="Goods invoices"
            columns={invoiceColumns}
            rows={invoices}
            rowKey={(r) => r.id}
            rowHref={(r) => `/invoices/${r.id}`}
          />
        </Card>
      )}
    </>
  );
}

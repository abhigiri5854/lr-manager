import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { listPodPending } from "@/lib/data/pod";
import { formatDate, formatPaise } from "@/lib/format";
import type { PodPendingRow } from "@/lib/types";

export const metadata: Metadata = { title: "POD pending" };

const columns: Column<PodPendingRow>[] = [
  { key: "lrNo", header: "LR no", cell: (r) => r.lrNo, mono: true },
  { key: "deliveredOn", header: "Delivered on", cell: (r) => formatDate(r.deliveredOn) },
  { key: "consignee", header: "Consignee", cell: (r) => r.consignee },
  { key: "days", header: "Days since delivery", cell: (r) => r.daysSinceDelivery },
  { key: "penalty", header: "Penalty so far", cell: (r) => `₹${formatPaise(r.penaltyPaise)}` },
];

export default async function PodPendingPage() {
  const rows = await listPodPending();

  return (
    <>
      <PageHeader title="POD pending" />
      <Card padding="table">
        <DataTable
          label="LRs waiting for POD"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.lrId}
          rowHref={(r) => `/lr/${r.lrId}/pod`}
          empty="No LRs waiting for POD."
        />
      </Card>
    </>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { listPodPending } from "@/lib/data/pod";
import { getActiveCompanyId } from "@/lib/data/session";
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

function PodTable({ rows, empty }: { rows: PodPendingRow[]; empty: string }) {
  return (
    <Card padding="table">
      <DataTable
        label="LRs waiting for POD"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.lrId}
        rowHref={(r) => `/lr/${r.lrId}/pod`}
        empty={empty}
      />
    </Card>
  );
}

/** Per-request: reads the active company from the session. */
async function PodPendingList() {
  const rows = await listPodPending(await getActiveCompanyId());
  return <PodTable rows={rows} empty="No LRs waiting for POD." />;
}

export default function PodPendingPage() {
  return (
    <>
      <PageHeader title="POD pending" />
      <Suspense fallback={<PodTable rows={[]} empty="Loading…" />}>
        <PodPendingList />
      </Suspense>
    </>
  );
}

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import type { DocumentReviewView } from "@/lib/data/import";

/**
 * Row review for an invoice / document file: the whole file is one record. Invoices are
 * saved from the Tax invoice form, so the action here is a link into it.
 */
export function DocumentReview({ view }: { view: DocumentReviewView }) {
  const columns: Column<DocumentReviewView>[] = [
    { key: "source", header: "Source", cell: (r) => r.source },
    { key: "record", header: "Record", wrap: true, cell: (r) => r.record },
    {
      key: "check",
      header: "Check",
      wrap: true,
      selfClamped: true,
      cell: (r) => (
        <>
          {r.reasons.map((m) => (
            <div key={m} className={r.status === "error" ? "text-danger" : "text-warning"}>
              {m}
            </div>
          ))}
          {r.checks.length > 0 && <div className="text-success">{r.checks.join(" · ")}</div>}
          {r.note && <div className="text-muted">{r.note}</div>}
        </>
      ),
    },
    {
      key: "action",
      header: "Action",
      cell: (r) =>
        r.openHref ? (
          <Link href={r.openHref}>{r.openLabel}</Link>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];
  return (
    <Card padding="table">
      <div className="mx-3 mt-3 mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[17px] font-bold">Row review</h2>
        <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
          <Chip tone="green">Valid {view.status === "valid" ? 1 : 0}</Chip>
          <Chip tone="amber">Warning {view.status === "warning" ? 1 : 0}</Chip>
          <Chip tone="red">Error {view.status === "error" ? 1 : 0}</Chip>
        </div>
      </div>
      <DataTable label="Row review" columns={columns} rows={[view]} rowKey={(r) => r.batchId} />
    </Card>
  );
}

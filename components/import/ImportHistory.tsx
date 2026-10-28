import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import type { ImportHistoryRow } from "@/lib/data/import";
import type { Page } from "@/lib/types";

const columns: Column<ImportHistoryRow>[] = [
  { key: "date", header: "Date", cell: (r) => r.date },
  { key: "file", header: "File", cell: (r) => r.fileName, mono: true },
  { key: "by", header: "By", cell: (r) => r.by },
  {
    key: "counts",
    header: "Rows",
    cell: (r) =>
      r.counts.valid + r.counts.warning + r.counts.error === 0
        ? "—"
        : `${r.counts.valid} valid · ${r.counts.warning} warning · ${r.counts.error} error`,
  },
  { key: "created", header: "Records created", align: "right", cell: (r) => r.created },
  {
    key: "status",
    header: "Status",
    wrap: true,
    cell: (r) =>
      r.status === "imported" ? (
        <Chip tone="green">Imported</Chip>
      ) : (
        <>
          <Chip tone="red">Failed</Chip>
          {r.note && <div className="mt-1 text-[13px] text-danger">{r.note}</div>}
        </>
      ),
  },
];

/** Import history (date, file, by, counts, status), 50 per page. */
export function ImportHistory({
  history,
  hrefFor,
}: {
  history: Page<ImportHistoryRow>;
  hrefFor: (page: number) => string;
}) {
  return (
    <Card title="Import history" padding="table">
      <DataTable
        label="Import history"
        columns={columns}
        rows={history.rows}
        rowKey={(r) => r.id}
        empty="Nothing imported yet. Finished imports and failed ones are listed here."
      />
      {history.total > history.pageSize && (
        <div className="mx-3 mt-3">
          <Pagination
            page={history.page}
            pageSize={history.pageSize}
            total={history.total}
            hrefFor={hrefFor}
            noun="imports"
          />
        </div>
      )}
    </Card>
  );
}

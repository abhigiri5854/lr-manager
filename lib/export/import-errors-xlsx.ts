import { utils, write } from "xlsx";
import type { ErrorReport } from "@/lib/data/import";

// Smart import → "Download error report (.xlsx)": the rows that couldn't be imported, each with
// what is wrong and the original cells, so the user can fix them in Excel and upload again.

const LEAD = ["Excel row", "Record", "What's wrong"];

export function importErrorReportWorkbook(report: ErrorReport): Uint8Array {
  const headers = [...LEAD, ...report.headers];
  const sheet = utils.aoa_to_sheet([
    headers,
    ...report.rows.map((r) => [r.rowNo, r.record, r.reason, ...r.cells]),
  ]);
  sheet["!cols"] = headers.map((h, i) => ({
    wch: i === 2 ? 48 : i === 1 ? 36 : Math.max(h.length + 2, 14),
  }));
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, "Errors");
  return write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Uint8Array;
}

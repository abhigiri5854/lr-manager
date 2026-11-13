import { utils, write, type CellObject } from "xlsx";
import type { EwbRow } from "@/lib/data/ewb";

// E-way register → .xlsx. Expiry is a real Excel date-time in India time.

const HEADERS = ["LR", "Challan", "Vehicle", "From", "To", "E-way no.", "Expiry", "Source", "Time left"];
const DATETIME_FORMAT = "dd-mm-yyyy hh:mm";

const text = (v: string | null): CellObject => (v ? { t: "s", v } : { t: "z" });
const excelIst = (iso: string): number => (new Date(iso).getTime() + 5.5 * 3_600_000) / 86_400_000 + 25_569;

export function ewayWorkbook(rows: EwbRow[]): Uint8Array {
  const body: CellObject[][] = rows.map((r) => [
    text(r.lrNo),
    text(r.challanNo),
    text(r.vehicleNo),
    text(r.source),
    text(r.destination),
    text(r.ewbNo),
    r.validUpto ? { t: "n", v: excelIst(r.validUpto), z: DATETIME_FORMAT } : { t: "z" },
    text(r.expirySource === "entered" ? "Entered" : r.expirySource === "computed" ? "Computed" : null),
    text(r.timeLeft),
  ]);
  const sheet = utils.aoa_to_sheet([HEADERS, ...body]);
  sheet["!cols"] = [12, 16, 14, 18, 18, 16, 18, 12, 18].map((wch) => ({ wch }));
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, "E-way bills");
  return write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Uint8Array;
}

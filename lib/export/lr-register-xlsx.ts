import { utils, write, type CellObject, type WorkSheet } from "xlsx";
import { paymentModeLabel } from "@/lib/labels";
import type { LrView } from "@/lib/types";

// LR register → .xlsx (SheetJS). Dates and money are real Excel values, so the sheet
// can be sorted and summed, shown as dd-mm-yyyy and Indian grouping (1,84,902.58).

const DATE_FORMAT = "dd-mm-yyyy";
const MONEY_FORMAT = "[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00";

const HEADERS = [
  "LR No",
  "LR date",
  "Status",
  "Consignor",
  "Consignee",
  "Billed to",
  "From",
  "To",
  "Truck",
  "Packages",
  "Value (₹)",
  "Invoice no(s)",
  "E-way bill no(s)",
  "E-way expiry",
  "Pay mode",
];

/** "2026-10-14" or an ISO timestamp → Excel date serial (UTC day). */
function excelDate(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000 + 25_569;
}

const text = (v: string | null): CellObject => (v ? { t: "s", v } : { t: "z" });
const date = (v: string | null): CellObject =>
  v ? { t: "n", v: excelDate(v), z: DATE_FORMAT } : { t: "z" };
const join = (values: Array<string | null>) => values.filter(Boolean).join(", ") || null;

function row(lr: LrView): CellObject[] {
  return [
    text(lr.lrNo),
    date(lr.lrDate),
    text(lr.status),
    text(lr.consignorName),
    text(lr.consigneeName),
    text(lr.billedToName),
    text(lr.fromPlace),
    text(lr.toPlace),
    text(lr.truckNumber),
    { t: "n", v: lr.totalPackages },
    lr.totalValuePaise === null
      ? { t: "z" }
      : { t: "n", v: lr.totalValuePaise / 100, z: MONEY_FORMAT },
    text(join(lr.lrInvoices.map((i) => i.invoiceNo))),
    text(join(lr.lrInvoices.map((i) => i.ewayBillNo))),
    date(lr.ewayExpiresAt),
    text(lr.paymentMode ? paymentModeLabel[lr.paymentMode] : null),
  ];
}

export function lrRegisterSheet(lrs: LrView[]): WorkSheet {
  const sheet = utils.aoa_to_sheet([HEADERS, ...lrs.map(row)]);
  sheet["!cols"] = HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  sheet["!autofilter"] = {
    ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lrs.length, c: HEADERS.length - 1 } }),
  };
  return sheet;
}

/** The .xlsx file as bytes. */
export function lrRegisterWorkbook(lrs: LrView[]): Uint8Array {
  const book = utils.book_new();
  utils.book_append_sheet(book, lrRegisterSheet(lrs), "LR register");
  return write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Uint8Array;
}

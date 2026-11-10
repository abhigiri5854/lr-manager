import { utils, write, type CellObject, type WorkSheet } from "xlsx";
import type { ChallanRegisterRow } from "@/lib/data/db/challans";

// Challan register → .xlsx (SheetJS). Dates and money are real Excel values, shown as dd-mm-yyyy
// and Indian grouping, so the sheet can be sorted and summed.

const DATE_FORMAT = "dd-mm-yyyy";
const MONEY_FORMAT = "[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00";

const HEADERS = [
  "Challan no.",
  "Date",
  "Branch",
  "Vehicle",
  "From",
  "To",
  "Payee",
  "Status",
  "Hire (₹)",
  "Paid (₹)",
  "Balance (₹)",
  "POD age (days)",
];

function excelDate(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000 + 25_569;
}

const text = (v: string | null): CellObject => (v ? { t: "s", v } : { t: "z" });
const rupees = (paise: number): CellObject => ({ t: "n", v: paise / 100, z: MONEY_FORMAT });

export function challanRegisterSheet(rows: ChallanRegisterRow[]): WorkSheet {
  const body: CellObject[][] = rows.map((r) => [
    text(r.challanNo),
    { t: "n", v: excelDate(r.challanDate), z: DATE_FORMAT },
    text(r.branchName),
    text(r.vehicleNo),
    text(r.source),
    text(r.destination),
    text(r.payeeName),
    text(r.status.replace("_", " ")),
    rupees(r.hirePaise),
    rupees(r.paidPaise),
    rupees(r.balancePaise),
    r.podAgeDays === null ? { t: "z" } : { t: "n", v: r.podAgeDays },
  ]);
  const sum = (pick: (r: ChallanRegisterRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const total: CellObject[] = [
    text("Total"),
    ...Array.from({ length: 7 }, (): CellObject => ({ t: "z" })),
    rupees(sum((r) => r.hirePaise)),
    rupees(sum((r) => r.paidPaise)),
    rupees(sum((r) => r.balancePaise)),
    { t: "z" },
  ];
  const sheet = utils.aoa_to_sheet([HEADERS, ...body, total]);
  sheet["!cols"] = [16, 12, 16, 14, 18, 18, 24, 14, 16, 16, 16, 14].map((wch) => ({ wch }));
  return sheet;
}

/** The .xlsx file as bytes. */
export function challanRegisterWorkbook(rows: ChallanRegisterRow[]): Uint8Array {
  const book = utils.book_new();
  utils.book_append_sheet(book, challanRegisterSheet(rows), "Challans");
  return write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Uint8Array;
}

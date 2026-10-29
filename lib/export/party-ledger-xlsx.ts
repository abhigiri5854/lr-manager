import { utils, write, type CellObject, type WorkSheet } from "xlsx";
import type { PartyLedger } from "@/lib/data/bill-reports";

// Party ledger → .xlsx (SheetJS). Dates and money are real Excel values, shown as dd-mm-yyyy and
// Indian grouping, so the sheet can be sorted and summed.

const DATE_FORMAT = "dd-mm-yyyy";
const MONEY_FORMAT = "[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00";
const KIND = { bill: "Bill", payment: "Payment", tds: "TDS" } as const;

const HEADERS = ["Date", "Type", "Reference", "Billed (₹)", "Received (₹)", "Balance (₹)"];

function excelDate(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000 + 25_569;
}

const text = (v: string): CellObject => (v ? { t: "s", v } : { t: "z" });
const rupees = (paise: number): CellObject =>
  paise ? { t: "n", v: paise / 100, z: MONEY_FORMAT } : { t: "z" };

export function partyLedgerSheet(partyName: string, ledger: PartyLedger): WorkSheet {
  const rows: CellObject[][] = ledger.entries.map((e) => [
    { t: "n", v: excelDate(e.date), z: DATE_FORMAT },
    text(KIND[e.kind]),
    text(e.ref),
    rupees(e.debitPaise),
    rupees(e.creditPaise),
    { t: "n", v: e.runningPaise / 100, z: MONEY_FORMAT },
  ]);
  const total: CellObject[] = [
    { t: "z" },
    text("Total"),
    { t: "z" },
    { t: "n", v: ledger.billedPaise / 100, z: MONEY_FORMAT },
    { t: "n", v: (ledger.receivedPaise + ledger.tdsPaise) / 100, z: MONEY_FORMAT },
    { t: "n", v: ledger.balancePaise / 100, z: MONEY_FORMAT },
  ];
  const sheet = utils.aoa_to_sheet([[text(partyName)], HEADERS, ...rows, total]);
  sheet["!cols"] = [14, 10, 34, 16, 16, 16].map((wch) => ({ wch }));
  return sheet;
}

/** The .xlsx file as bytes. */
export function partyLedgerWorkbook(partyName: string, ledger: PartyLedger): Uint8Array {
  const book = utils.book_new();
  utils.book_append_sheet(book, partyLedgerSheet(partyName, ledger), "Ledger");
  return write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Uint8Array;
}

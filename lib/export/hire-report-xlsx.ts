import * as XLSX from "xlsx";
import type {
  HireOutstandingRow,
  HireOutstandingTotals,
  LaneRateRow,
  LaneRateTotals,
  PodPendingRow,
  PodPendingTotals,
  ReportPage,
  TdsRegisterRow,
  TdsTotals,
  TripMarginRow,
  TripMarginTotals,
} from "@/lib/data/db/hire-reports";
import { bucketOf } from "@/lib/data/db/hire-reports";
import { formatDate } from "@/lib/format";

type Cell = string | number | null;
export type Sheet = {
  name: string;
  headers: string[];
  /** Column indexes holding rupees (number format #,##0.00). */
  money: number[];
  rows: Cell[][];
  total: Cell[];
};

const rs = (paise: number) => paise / 100;
const route = (s: string | null, d: string | null) => (s || d ? `${s ?? "—"} → ${d ?? "—"}` : "");

export function hireSheet(p: ReportPage<HireOutstandingRow, HireOutstandingTotals>): Sheet {
  const t = p.totals;
  return {
    name: "Hire outstanding",
    headers: ["Party", "Challans", "Hire + additions − deductions ₹", "TDS ₹", "Paid ₹", "Balance ₹"],
    money: [2, 3, 4, 5],
    rows: p.rows.map((r) => [
      r.partyName,
      r.challans,
      rs(r.hirePaise),
      rs(r.tdsPaise),
      rs(r.paidPaise),
      rs(r.balancePaise),
    ]),
    total: ["Total", t.challans, rs(t.hirePaise), rs(t.tdsPaise), rs(t.paidPaise), rs(t.balancePaise)],
  };
}

export function podSheet(p: ReportPage<PodPendingRow, PodPendingTotals>): Sheet {
  return {
    name: "POD pending",
    headers: [
      "Challan no.",
      "Date",
      "Branch",
      "Vehicle",
      "Party",
      "Route",
      "Clock started",
      "Since",
      "Days",
      "Bucket",
    ],
    money: [],
    rows: p.rows.map((r) => [
      r.challanNo,
      formatDate(r.challanDate),
      r.branchName,
      r.vehicleNo,
      r.partyName,
      route(r.source, r.destination),
      r.sinceKind === "unloaded" ? "Unloaded" : "Dispatched",
      formatDate(r.sinceDate),
      r.ageDays,
      bucketOf(r.ageDays),
    ]),
    total: ["Total", p.totals.n, null, null, null, null, null, null, null, null],
  };
}

export function tdsSheet(p: ReportPage<TdsRegisterRow, TdsTotals>): Sheet {
  const t = p.totals;
  return {
    name: "TDS register",
    headers: [
      "Payment date",
      "Voucher no.",
      "Challan no.",
      "Party",
      "PAN",
      "PAN type",
      "Section",
      "Gross ₹",
      "TDS %",
      "TDS ₹",
      "Net ₹",
      "Note",
    ],
    money: [7, 9, 10],
    rows: p.rows.map((r) => [
      formatDate(r.paidOn),
      r.paymentNo,
      r.challanNo,
      r.partyName,
      r.pan,
      r.panType,
      r.section,
      rs(r.grossPaise),
      r.tdsPercent,
      rs(r.tdsPaise),
      rs(r.netPaise),
      r.declaration ? "Declaration 194C(6)" : null,
    ]),
    total: ["Total", null, null, null, null, null, null, rs(t.grossPaise), null, rs(t.tdsPaise), rs(t.netPaise), null],
  };
}

export function marginSheet(p: ReportPage<TripMarginRow, TripMarginTotals>): Sheet {
  const t = p.totals;
  return {
    name: "Trip margin",
    headers: [
      "Challan no.",
      "Date",
      "Branch",
      "Vehicle",
      "Vehicle type",
      "Route",
      "Party freight ₹",
      "Hire + additions − deductions ₹",
      "Margin ₹",
      "Margin %",
      "Low margin",
    ],
    money: [6, 7, 8],
    rows: p.rows.map((r) => [
      r.challanNo,
      formatDate(r.challanDate),
      r.branchName,
      r.vehicleNo,
      r.vehicleType,
      route(r.source, r.destination),
      rs(r.revenuePaise),
      rs(r.costPaise),
      rs(r.marginPaise),
      r.marginPct,
      r.low ? "Yes" : null,
    ]),
    total: ["Total", null, null, null, null, null, rs(t.revenuePaise), rs(t.costPaise), rs(t.marginPaise), t.marginPct, t.lowCount],
  };
}

export function laneSheet(p: ReportPage<LaneRateRow, LaneRateTotals>): Sheet {
  return {
    name: "Lane rates",
    headers: ["From", "To", "Vehicle type", "Trips", "Min hire ₹", "Avg hire ₹", "Max hire ₹", "Last hire ₹", "Last date"],
    money: [4, 5, 6, 7],
    rows: p.rows.map((r) => [
      r.source,
      r.destination,
      r.vehicleType,
      r.trips,
      rs(r.minPaise),
      rs(r.avgPaise),
      rs(r.maxPaise),
      rs(r.lastPaise),
      formatDate(r.lastDate),
    ]),
    total: ["Total", null, null, p.totals.trips, null, null, null, null, null],
  };
}

export function reportWorkbook(sheet: Sheet): Uint8Array {
  const aoa: Cell[][] = [sheet.headers, ...sheet.rows, sheet.total];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let r = 1; r < aoa.length; r++) {
    for (const c of sheet.money) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
    }
  }
  ws["!cols"] = sheet.headers.map((h, i) => ({
    wch: Math.min(40, Math.max(h.length + 2, ...aoa.slice(1).map((row) => String(row[i] ?? "").length + 2))),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

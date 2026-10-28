// Excel booking import: the raw rows the reader returned + the column mapping → one reviewed
// record per row (valid / warning / error, the reason, and what the user may do with it).
// Pure: everything that needs the database comes in through `Lookups`, so it is easy to test.
import { parseRupees } from "@/lib/format";
import type { ImportRowAction } from "@/lib/types";
import {
  gstinError,
  isValidMobile,
  isValidVehicleNo,
  normaliseGstin,
  normaliseMobile,
  normaliseVehicleNo,
} from "@/lib/validators/common";
import { SKIP_FIELD } from "./fields";
import type { ExcelReadResult } from "./types";

export type RowStatus = "valid" | "warning" | "error";

/** What the review needs to know about records already in the company. */
export type Lookups = {
  /** The company's LR prefix, stripped from sheet numbers like "RSL/19021". */
  lrPrefix: string;
  /** An LR with this number already exists (any status); `updatable` = not cancelled or billed. */
  lrByNo(lrNo: string): { id: string; status: string; updatable: boolean } | null;
  partyByGstin(gstin: string): { id: string; name: string } | null;
  partyByName(name: string): { id: string; name: string } | null;
  truckByNumber(number: string): { id: string } | null;
  /** A tax invoice with this number from the seller with this GSTIN. */
  taxInvoice(invoiceNo: string, sellerGstin: string | null): { id: string } | null;
};

export type SheetParty = { name: string; gstin: string | null };

/** One row, read through the mapping. Null/empty = not in the sheet or not usable. */
export type ParsedRow = {
  rowNo: number;
  /** Digits only (the prefix is added when the LR is created). */
  lrNo: string | null;
  lrDate: string | null;
  fromPlace: string | null;
  toPlace: string | null;
  consignor: SheetParty | null;
  consignee: SheetParty | null;
  invoiceNo: string | null;
  /** Normalised, only when it is a valid vehicle number. */
  vehicleNo: string | null;
  driverMobile: string | null;
  packages: number | null;
  goods: string | null;
  billingWeight: string | null;
  actualWeight: string | null;
  ratePaise: number | null;
  freightPaise: number | null;
  remarks: string | null;
};

export type ReviewRow = {
  rowNo: number;
  /** "Excel row 4" */
  source: string;
  /** "19021 · Ashirvad Pipes → Maa Vaishno Hardware" */
  record: string;
  status: RowStatus;
  /** Good news: what was matched or will be created. */
  checks: string[];
  /** Problems; errors block the row, warnings don't. */
  reasons: string[];
  /** The LR that already has this number. */
  existingLrId: string | null;
  allowed: ImportRowAction[];
  defaultAction: ImportRowAction;
  /** The user's choice, or the default. */
  action: ImportRowAction;
  parsed: ParsedRow;
};

export type ReviewCounts = { valid: number; warning: number; error: number };

// ---------- cell parsing ----------
const text = (s: string | undefined): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

/** "15-10-2026", "15/10/26", "2026-10-15" → "2026-10-15"; null when blank; undefined when not a date. */
export function parseSheetDate(raw: string | undefined): string | null | undefined {
  const s = text(raw);
  if (!s) return null;
  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) {
    [d, m] = [Number(dmy[1]), Number(dmy[2])];
    y = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
  } else return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return undefined;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "1,200.5" → "1200.5"; null when blank; undefined when not a weight. */
function parseWeight(raw: string | undefined): string | null | undefined {
  const s = (raw ?? "").replace(/[\s,]/g, "");
  if (s === "") return null;
  return /^\d+(\.\d{1,3})?$/.test(s) ? s : undefined;
}

/** Sheet LR numbers may carry the company prefix ("RSL/19021"); we keep the digits. */
function lrNumber(raw: string | null, prefix: string): string | null | undefined {
  if (!raw) return null;
  const p = prefix.trim().toUpperCase();
  const upper = raw.toUpperCase();
  const digits = p && upper.startsWith(p) ? upper.slice(p.length) : upper;
  return /^\d{1,9}$/.test(digits) ? String(Number(digits)) : undefined;
}

/** Field key → the header mapped to it (the first one, if two headers share a field). */
function headerFor(mapping: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [header, field] of Object.entries(mapping)) {
    if (field !== SKIP_FIELD && !out.has(field)) out.set(field, header);
  }
  return out;
}

const partyOf = (name: string | null, gstin: string | null): SheetParty | null =>
  name || gstin ? { name: name ?? "", gstin } : null;

// ---------- the review ----------
export function reviewExcelRows(
  result: ExcelReadResult,
  mapping: Record<string, string>,
  chosen: Record<string, ImportRowAction>,
  lookups: Lookups,
): { rows: ReviewRow[]; counts: ReviewCounts } {
  const header = headerFor(mapping);
  const seenLrNo = new Map<string, number>();
  const rows: ReviewRow[] = [];

  for (const row of result.rows) {
    const cell = (field: string): string | undefined => {
      const h = header.get(field);
      return h === undefined ? undefined : row.cells[h];
    };
    const errors: string[] = [];
    const warnings: string[] = [];
    const checks: string[] = [];

    // LR number
    const lrRaw = text(cell("lr_no"));
    const lrNo = lrNumber(lrRaw, lookups.lrPrefix);
    if (lrNo === null) errors.push("LR number is missing");
    else if (lrNo === undefined) errors.push(`LR number "${lrRaw}" should be digits only`);

    // Date
    const date = parseSheetDate(cell("lr_date"));
    if (date === undefined) errors.push(`LR date "${text(cell("lr_date"))}" isn't a real date`);
    else if (date === null) warnings.push("LR date is empty");

    // Parties (GSTIN checked first: a wrong GSTIN blocks the row)
    const partyCell = (role: "consignor" | "consignee") => {
      const name = text(cell(`${role}_name`));
      const gstinRaw = text(cell(`${role}_gstin`));
      let gstin: string | null = null;
      if (gstinRaw) {
        const g = normaliseGstin(gstinRaw);
        const err = gstinError(g);
        if (err) errors.push(`${role === "consignor" ? "Consignor" : "Consignee"} ${err}`);
        else gstin = g;
      }
      return { name, gstin, bad: Boolean(gstinRaw && !gstin) };
    };
    const consignorCell = partyCell("consignor");
    const consigneeCell = partyCell("consignee");
    const describeParty = (label: string, p: ReturnType<typeof partyCell>) => {
      if (!p.name && !p.gstin) {
        if (!p.bad) warnings.push(`${label} is empty`);
        return;
      }
      const byGstin = p.gstin ? lookups.partyByGstin(p.gstin) : null;
      const byName = !byGstin && p.name ? lookups.partyByName(p.name) : null;
      const found = byGstin ?? byName;
      // Matching by GSTIN is the normal case and says nothing; a name match is worth a look.
      if (found && !byGstin) checks.push(`${label} matched to ${found.name} by name`);
      else if (p.gstin) checks.push(`New party ${p.name || p.gstin} will be added`);
      else if (p.name && !p.bad) {
        warnings.push(`New party ${p.name} has no GSTIN — it will be added without one`);
      }
    };
    describeParty("Consignor", consignorCell);
    describeParty("Consignee", consigneeCell);

    // Invoice, truck, driver
    const invoiceNo = text(cell("invoice_no"));
    if (invoiceNo) {
      const inv = lookups.taxInvoice(invoiceNo, consignorCell.gstin);
      if (inv) checks.push(`Tax invoice ${invoiceNo} found — the LR will be linked to it`);
    }
    const vehicleRaw = text(cell("vehicle_no"));
    let vehicleNo: string | null = null;
    if (vehicleRaw) {
      const v = normaliseVehicleNo(vehicleRaw);
      if (isValidVehicleNo(v)) {
        vehicleNo = v;
        if (!lookups.truckByNumber(v)) checks.push(`New truck ${v} will be added`);
      } else {
        warnings.push(
          `Vehicle no. "${vehicleRaw}" format unusual — the LR is imported without a truck`,
        );
      }
    }
    const driverRaw = text(cell("driver_mobile"));
    let driverMobile: string | null = null;
    if (driverRaw) {
      if (isValidMobile(driverRaw)) driverMobile = normaliseMobile(driverRaw);
      else warnings.push(`Driver mobile "${driverRaw}" isn't a 10-digit number — left out`);
    }

    // Numbers
    let packages: number | null = null;
    const pkgRaw = text(cell("packages"));
    if (pkgRaw) {
      if (/^\d+$/.test(pkgRaw.replace(/,/g, ""))) packages = Number(pkgRaw.replace(/,/g, ""));
      else warnings.push(`Packages "${pkgRaw}" isn't a whole number — left out`);
    }
    const weight = (field: string, label: string): string | null => {
      const w = parseWeight(cell(field));
      if (w === undefined)
        warnings.push(`${label} "${text(cell(field))}" isn't a number — left out`);
      return w ?? null;
    };
    const billingWeight = weight("billing_weight", "Billing weight");
    const actualWeight = weight("actual_weight", "Actual weight");
    const money = (field: string, label: string): number | null => {
      const p = parseRupees(cell(field) ?? "");
      if (p === undefined)
        warnings.push(`${label} "${text(cell(field))}" isn't an amount — left out`);
      return p ?? null;
    };
    const ratePaise = money("rate", "Rate");
    const freightPaise = money("freight", "Freight");

    // Duplicates
    let existingLrId: string | null = null;
    let updatable = false;
    if (typeof lrNo === "string") {
      const firstRow = seenLrNo.get(lrNo);
      if (firstRow !== undefined) {
        errors.push(`LR ${lrNo} appears again in this file (row ${firstRow})`);
      } else {
        seenLrNo.set(lrNo, row.rowNo);
        const existing = lookups.lrByNo(lrNo);
        if (existing) {
          existingLrId = existing.id;
          updatable = existing.updatable;
          warnings.unshift(
            existing.updatable
              ? `LR ${lrNo} is already in the system`
              : `LR ${lrNo} is already in the system (${existing.status}) — it can't be updated`,
          );
        }
      }
    }

    const status: RowStatus = errors.length ? "error" : warnings.length ? "warning" : "valid";
    const allowed: ImportRowAction[] = errors.length
      ? ["skip"]
      : existingLrId
        ? updatable
          ? ["skip", "update"]
          : ["skip"]
        : ["import", "skip"];
    const defaultAction: ImportRowAction = errors.length || existingLrId ? "skip" : "import";
    const picked = chosen[String(row.rowNo)];
    const action = picked && allowed.includes(picked) ? picked : defaultAction;

    const consignor = partyOf(consignorCell.name, consignorCell.gstin);
    const consignee = partyOf(consigneeCell.name, consigneeCell.gstin);
    rows.push({
      rowNo: row.rowNo,
      source: `Excel row ${row.rowNo}`,
      record: `${typeof lrNo === "string" ? lrNo : (lrRaw ?? "—")} · ${consignor?.name || "—"} → ${consignee?.name || "—"}`,
      status,
      checks,
      reasons: [...errors, ...warnings],
      existingLrId,
      allowed,
      defaultAction,
      action,
      parsed: {
        rowNo: row.rowNo,
        lrNo: typeof lrNo === "string" ? lrNo : null,
        lrDate: typeof date === "string" ? date : null,
        fromPlace: text(cell("from_place")),
        toPlace: text(cell("to_place")),
        consignor,
        consignee,
        invoiceNo,
        vehicleNo,
        driverMobile,
        packages,
        goods: text(cell("goods")),
        billingWeight,
        actualWeight,
        ratePaise,
        freightPaise,
        remarks: text(cell("remarks")),
      },
    });
  }

  const counts: ReviewCounts = { valid: 0, warning: 0, error: 0 };
  for (const r of rows) counts[r.status]++;
  return { rows, counts };
}

/** Rows that "Import valid rows" will act on. */
export const importableRows = (rows: ReviewRow[]) =>
  rows.filter((r) => r.status !== "error" && r.action !== "skip");

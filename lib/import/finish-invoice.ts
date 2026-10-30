// Turns what the readers found (a Draft + which reader supplied each field) into the
// DocumentReadResult Smart import reviews. This is where our own rules check the readers' work:
// GSTIN checksums, vehicle numbers, and item rows against the printed totals (lib/tax.ts).
// Anything a reader couldn't prove goes into `lowConfidence` and shows orange; nothing is saved here.
import { formatPaise } from "@/lib/format";
import { GST_RATES_BP } from "@/lib/gst";
import { computeInvoiceTax } from "@/lib/tax";
import { gstinError, isValidVehicleNo, normaliseGstin, normaliseVehicleNo } from "@/lib/validators/common";
import type { Draft, DraftSources } from "./draft";
import type {
  DocumentReadResult,
  ReadInvoice,
  ReadInvoiceLine,
  ReadParty,
  ReadSource,
} from "./types";

/** Rupee tolerance for rounding differences between our per-line maths and the printed totals. */
const TOLERANCE_PAISE = 100;

const party = (name: string, gstin: string | null): ReadParty => ({
  name,
  place: null,
  gstin,
  pan: gstin ? gstin.slice(2, 12) : null,
  phone: null,
  address: null,
  stateCode: gstin ? gstin.slice(0, 2) : null,
  pincode: null,
});

/** The GST rate that fits tax ÷ taxable, or null. */
function inferRateBp(d: Draft): number | null {
  const tax = (d.sgstPaise ?? 0) + (d.cgstPaise ?? 0) + (d.igstPaise ?? 0);
  if (!d.taxablePaise || d.taxablePaise <= 0) return null;
  const bp = (tax / d.taxablePaise) * 10000;
  return GST_RATES_BP.find((r) => Math.abs(r - bp) <= 15) ?? null;
}

type Checked = { gstin: string | null; ok: boolean };

function checkGstin(value: string | undefined): Checked {
  if (!value) return { gstin: null, ok: false };
  const g = normaliseGstin(value);
  return gstinError(g) === null ? { gstin: g, ok: true } : { gstin: null, ok: false };
}

/**
 * Do the item rows add up to the printed taxable value and total (within a rupee)?
 * null when the document gave neither, so there is nothing to compare with.
 */
function reconciles(
  draft: Draft,
  lines: ReadInvoiceLine[],
  sellerGstin: string | null,
  buyerGstin: string | null,
): boolean | null {
  if (draft.taxablePaise === undefined && draft.totalPaise === undefined) return null;
  const intra =
    (draft.igstPaise ?? 0) === 0 &&
    (sellerGstin?.slice(0, 2) === buyerGstin?.slice(0, 2) || !buyerGstin);
  const calc = computeInvoiceTax(lines, intra, { roundOff: true }).totals;
  const within = (a: number, b: number | undefined) =>
    b === undefined || Math.abs(a - b) <= TOLERANCE_PAISE;
  return within(calc.taxablePaise, draft.taxablePaise) && within(calc.totalPaise, draft.totalPaise);
}

/**
 * What is wrong with a draft a reader returned, by the same checks finishInvoice applies:
 * "sellerGstin" / "buyerGstin" (present but fails the checksum) and "totals" (item rows don't add
 * up to the printed totals). Empty = nothing to doubt. Used to decide on a second, stronger read.
 */
export function draftProblems(draft: Draft): string[] {
  const problems: string[] = [];
  if (draft.sellerGstin && !checkGstin(draft.sellerGstin).ok) problems.push("sellerGstin");
  if (draft.buyerGstin && !checkGstin(draft.buyerGstin).ok) problems.push("buyerGstin");
  if (draft.lines.length) {
    const inferred = inferRateBp(draft);
    const lines = draft.lines.map((l) => ({
      itemCode: null,
      description: l.description,
      hsn: l.hsn,
      uom: l.uom,
      qty: l.qty,
      ratePaise: l.ratePaise,
      discountPaise: 0,
      gstRateBp: l.gstRateBp ?? inferred ?? 1800,
    }));
    const seller = draft.sellerGstin ? checkGstin(draft.sellerGstin).gstin : null;
    const buyer = draft.buyerGstin ? checkGstin(draft.buyerGstin).gstin : null;
    if (reconciles(draft, lines, seller, buyer) === false) problems.push("totals");
  }
  return problems;
}

export function finishInvoice(
  draft: Draft,
  sources: DraftSources,
  readBy: ReadSource[],
  pages: number,
): DocumentReadResult {
  const low = new Set<string>();
  const fromQr = (k: keyof Draft) => sources[k] === "qr";

  // ----- header -----
  if (!draft.invoiceNo || !fromQr("invoiceNo")) low.add("invoiceNo");
  if (!draft.invoiceDate || !fromQr("invoiceDate")) low.add("invoiceAt");

  const invoiceAt = new Date(
    `${draft.invoiceDate ?? new Date().toISOString().slice(0, 10)}T12:00:00+05:30`,
  ).toISOString();

  const seller = checkGstin(draft.sellerGstin);
  const buyer = checkGstin(draft.buyerGstin);
  // A GSTIN that fails the checksum is dropped (never saved) and the party is checked by hand.
  if (!seller.ok) low.add("seller");
  if (!buyer.ok) low.add("billTo");

  const truckNo = draft.vehicleNo ? normaliseVehicleNo(draft.vehicleNo) : null;
  const truck = truckNo && isValidVehicleNo(truckNo) ? truckNo : null;
  if (draft.vehicleNo && !truck) low.add("truck");

  // ----- item rows, checked against the totals -----
  const inferred = inferRateBp(draft);
  const lines: ReadInvoiceLine[] = draft.lines.map((l, i) => {
    const rate = l.gstRateBp ?? inferred ?? 1800;
    if (l.gstRateBp === null && inferred === null) low.add(`lines.${i}.gstRateBp`);
    const hsn = l.hsn ?? draft.mainHsn ?? null;
    if (!l.hsn) low.add(`lines.${i}.hsn`);
    return {
      itemCode: null,
      description: l.description,
      hsn,
      uom: l.uom,
      qty: l.qty,
      ratePaise: l.ratePaise,
      discountPaise: 0,
      gstRateBp: rate,
    };
  });

  if (lines.length) {
    const reconciled = reconciles(draft, lines, seller.gstin, buyer.gstin);
    const countOk = draft.itemCount === undefined || draft.itemCount === lines.length;
    if (reconciled === false || reconciled === null || !countOk) {
      lines.forEach((_, i) => {
        for (const f of ["description", "qty", "ratePaise", "gstRateBp"]) low.add(`lines.${i}.${f}`);
      });
    }
  }
  if (!lines.length) low.add("lines.0.description");

  const invoice: ReadInvoice = {
    invoiceNo: draft.invoiceNo ?? "",
    invoiceAt,
    seller: party(draft.sellerName ?? seller.gstin ?? "Seller", seller.gstin),
    billTo: party(draft.buyerName ?? buyer.gstin ?? "Buyer", buyer.gstin),
    shipTo: null,
    customerRef: null,
    customerRefDate: null,
    soNo: null,
    soDate: null,
    doNo: null,
    sapRef: null,
    transporterName: null,
    vehicleNo: truck,
    driverMobile: null,
    shipFrom: null,
    incoterm: null,
    ewayBillNo: draft.ewayBillNo ?? null,
    irn: draft.irn ?? null,
    qrPayload: draft.qrPayload ?? null,
    lines,
  };

  const bits = [
    seller.ok && buyer.ok ? "Seller, buyer" : "Parties to check",
    `${lines.length} item${lines.length === 1 ? "" : "s"}`,
    draft.taxablePaise !== undefined ? `taxable ₹${formatPaise(draft.taxablePaise)}` : null,
    draft.totalPaise !== undefined && draft.taxablePaise === undefined
      ? `total ₹${formatPaise(draft.totalPaise)}`
      : null,
    truck ? `truck ${truck}` : null,
  ].filter(Boolean);

  const found = Boolean(
    draft.invoiceNo ||
      lines.length ||
      draft.sellerGstin ||
      draft.buyerGstin ||
      draft.sellerName ||
      draft.buyerName ||
      draft.totalPaise !== undefined ||
      draft.taxablePaise !== undefined,
  );
  return {
    kind: "document",
    documentType: found ? "tax_invoice" : "unknown",
    pages,
    summary: found ? bits.join(", ") : "Couldn't read an invoice from this file",
    invoice: found ? invoice : null,
    lr: null,
    lowConfidence: [...low],
    readBy,
  };
}

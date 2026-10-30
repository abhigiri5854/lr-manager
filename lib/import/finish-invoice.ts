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

const LABEL_NAMES =
  /^(?:seller|buyer|bill(?:ed)?\s*to|ship(?:ped)?\s*to|consignor|consignee|supplier|customer|recipient|from|to|name)\s*[:.]?$/i;
const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][A-Z0-9]$/i;

/** A printed name, or "" when the reader gave a label ("Seller") or a GSTIN instead of one. */
function cleanName(name: string | undefined): string {
  const n = name?.replace(/\s+/g, " ").trim() ?? "";
  return LABEL_NAMES.test(n) || GSTIN_SHAPE.test(n) ? "" : n;
}

/** The one GST rate every line shares, or null. */
function commonRate(lines: ReadInvoiceLine[]): number | null {
  const first = lines[0]?.gstRateBp;
  return first !== undefined && lines.every((l) => l.gstRateBp === first) ? first : null;
}

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

/** `gstin` is the value as printed (normalised); `ok` is false when the checksum fails, so the party is marked "check". */
type Checked = { gstin: string | null; ok: boolean };

function checkGstin(value: string | undefined): Checked {
  if (!value) return { gstin: null, ok: false };
  const g = normaliseGstin(value);
  return { gstin: g, ok: gstinError(g) === null };
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
 * What is wrong with a draft a reader returned: "totals" (item rows don't add up to the printed
 * totals). Empty = nothing to doubt. Used to decide on a second read. A GSTIN failing its checksum
 * is not a problem here: the value is kept as printed and only marked "check" by finishInvoice.
 */
export function draftProblems(draft: Draft): string[] {
  const problems: string[] = [];
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
    const seller = checkGstin(draft.sellerGstin).gstin;
    const buyer = checkGstin(draft.buyerGstin).gstin;
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

  // An unreadable date stays empty for the user to fill in; it is never defaulted to today.
  const invoiceAt = draft.invoiceDate
    ? new Date(`${draft.invoiceDate}T12:00:00+05:30`).toISOString()
    : null;

  const seller = checkGstin(draft.sellerGstin);
  const buyer = checkGstin(draft.buyerGstin);
  // A GSTIN that fails the checksum is kept as printed, and the party is marked "check".
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
    // A name is only ever a printed name: no "Seller" / "Buyer" label and no GSTIN stands in for it.
    seller: party(cleanName(draft.sellerName), seller.gstin),
    billTo: party(cleanName(draft.buyerName), buyer.gstin),
    shipTo:
      draft.shipToName || draft.shipToGstin
        ? party(cleanName(draft.shipToName), draft.shipToGstin ? normaliseGstin(draft.shipToGstin) : null)
        : null,
    customerRef: null,
    customerRefDate: null,
    soNo: null,
    soDate: null,
    doNo: null,
    sapRef: null,
    transporterName: draft.transporter ?? null,
    vehicleNo: truck,
    driverMobile: null,
    shipFrom: null,
    incoterm: null,
    ewayBillNo: draft.ewayBillNo ?? null,
    irn: draft.irn ?? null,
    qrPayload: draft.qrPayload ?? null,
    lines,
    gstRateBp: commonRate(lines),
    route:
      draft.route ?? (draft.fromPlace && draft.toPlace ? `${draft.fromPlace} - ${draft.toPlace}` : null),
    fromPlace: draft.fromPlace ?? null,
    toPlace: draft.toPlace ?? null,
    destination: draft.destination ?? null,
    lrNo: draft.lrNo ?? null,
    lrDate: draft.lrDate ?? null,
    ackNo: draft.ackNo ?? null,
    sac: draft.sac ?? null,
    placeOfSupply: draft.placeOfSupply ?? null,
    otherReference: draft.otherReference ?? null,
    roundOffPaise: draft.roundOffPaise ?? null,
    printed: {
      ...(draft.taxablePaise !== undefined && { taxablePaise: draft.taxablePaise }),
      ...(draft.sgstPaise !== undefined && { sgstPaise: draft.sgstPaise }),
      ...(draft.cgstPaise !== undefined && { cgstPaise: draft.cgstPaise }),
      ...(draft.igstPaise !== undefined && { igstPaise: draft.igstPaise }),
      ...(draft.totalPaise !== undefined && { totalPaise: draft.totalPaise }),
    },
    ...(draft.freightLines?.length && { freightLines: draft.freightLines }),
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
      draft.freightLines?.length ||
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

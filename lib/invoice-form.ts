// Tax invoice form: what the screen edits, and how it becomes the data-layer input.
// Pure functions so the browser's live totals and the server's saved totals use the same maths.
import { formatPaise, parseRupees } from "@/lib/format";
import { partyState } from "@/lib/gst";
import {
  isoToIstInput,
  istInputToIso,
  rowKey,
  type PartyOption,
  type TruckOption,
} from "@/lib/lr-form";
import { computeInvoiceTax } from "@/lib/tax";
import type { Item, TaxInvoice } from "@/lib/types";
import type { TaxInvoiceInput } from "@/lib/validators/invoice";

export type InvoiceLineRow = {
  key: string;
  id: string | null;
  itemId: string | null;
  itemCode: string;
  description: string;
  hsn: string;
  uom: string;
  qty: string;
  /** Rupees as typed, e.g. "4,030.04". */
  rate: string;
  discount: string;
  /** Basis points as a string ("1800"), "" until chosen. */
  gstRateBp: string;
};

export type InvoiceFormValues = {
  /** Only edited for imported invoices; own invoices get theirs on Finalise. */
  invoiceNo: string;
  /** yyyy-mm-ddThh:mm in IST. */
  invoiceAt: string;
  customerRef: string;
  customerRefDate: string;
  soNo: string;
  soDate: string;
  doNo: string;
  sapRef: string;
  billTo: PartyOption | null;
  shipSame: boolean;
  shipTo: PartyOption | null;
  /** Chosen state, used only when the ship-to party has none (unregistered buyer). */
  placeOfSupply: string;
  transporterName: string;
  truck: TruckOption | null;
  driverMobile: string;
  shipFrom: string;
  incoterm: string;
  lines: InvoiceLineRow[];
};

export type InvoiceFormErrors = Record<string, string>;

export const INCOTERMS = [
  "Ex Works",
  "Ex Works with Insurance",
  "FOR destination",
  "FOB",
  "CIF",
  "CFR",
  "DAP",
  "DDP",
] as const;

export function emptyLine(): InvoiceLineRow {
  return {
    key: rowKey(),
    id: null,
    itemId: null,
    itemCode: "",
    description: "",
    hsn: "",
    uom: "",
    qty: "",
    rate: "",
    discount: "",
    gstRateBp: "",
  };
}

/** An item picked from the master fills the line (qty and discount stay as typed). */
export function lineFromItem(row: InvoiceLineRow, item: Item): InvoiceLineRow {
  return {
    ...row,
    itemId: item.id,
    itemCode: item.code ?? "",
    description: item.name,
    hsn: item.hsn ?? row.hsn,
    uom: item.uom ?? row.uom,
    gstRateBp: item.gstRateBp == null ? row.gstRateBp : String(item.gstRateBp),
    rate: item.lastRatePaise == null ? row.rate : formatPaise(item.lastRatePaise),
  };
}

export function emptyInvoiceForm(nowIst: string): InvoiceFormValues {
  return {
    invoiceNo: "",
    invoiceAt: nowIst,
    customerRef: "",
    customerRefDate: "",
    soNo: "",
    soDate: "",
    doNo: "",
    sapRef: "",
    billTo: null,
    shipSame: true,
    shipTo: null,
    placeOfSupply: "",
    transporterName: "",
    truck: null,
    driverMobile: "",
    shipFrom: "",
    incoterm: "",
    lines: [emptyLine()],
  };
}

const money = (p: number) => formatPaise(p);

export function invoiceToFormValues(
  inv: TaxInvoice,
  picked: { billTo: PartyOption | null; shipTo: PartyOption | null; truck: TruckOption | null },
): InvoiceFormValues {
  return {
    invoiceNo: inv.invoiceNo ?? "",
    invoiceAt: isoToIstInput(inv.invoiceAt),
    customerRef: inv.customerRef ?? "",
    customerRefDate: inv.customerRefDate ?? "",
    soNo: inv.soNo ?? "",
    soDate: inv.soDate ?? "",
    doNo: inv.doNo ?? "",
    sapRef: inv.sapRef ?? "",
    billTo: picked.billTo,
    shipSame: !inv.shipToId,
    shipTo: picked.shipTo,
    placeOfSupply: inv.placeOfSupplyStateCode,
    transporterName: inv.transporterName ?? "",
    truck: picked.truck,
    driverMobile: inv.driverMobile ?? "",
    shipFrom: inv.shipFrom ?? "",
    incoterm: inv.incoterm ?? "",
    lines: inv.lines.map((l) => ({
      key: rowKey(),
      id: l.id,
      itemId: l.itemId,
      itemCode: l.itemCode ?? "",
      description: l.description,
      hsn: l.hsn ?? "",
      uom: l.uom ?? "",
      qty: l.qty,
      rate: money(l.ratePaise),
      discount: l.discountPaise ? money(l.discountPaise) : "",
      gstRateBp: String(l.gstRateBp),
    })),
  };
}

const blankLine = (l: InvoiceLineRow) =>
  !l.itemId && !l.description.trim() && !l.qty.trim() && !l.rate.trim();

/** The party goods are shipped to (bill-to when "same as bill to"). */
export function shipParty(v: Pick<InvoiceFormValues, "shipSame" | "billTo" | "shipTo">) {
  return v.shipSame ? v.billTo : v.shipTo;
}

/** Place of supply: the ship-to party's state, else the chosen one. "" when unknown. */
export function placeOfSupply(v: InvoiceFormValues): string {
  return partyState(shipParty(v)) ?? v.placeOfSupply;
}

/** True when the ship-to party has no state of its own, so the user must choose one. */
export function needsStateChoice(v: InvoiceFormValues): boolean {
  const p = shipParty(v);
  return !!p && !partyState(p);
}

type ParsedLine = TaxInvoiceInput["lines"][number];

function parseLine(l: InvoiceLineRow, i: number, errors: InvoiceFormErrors): ParsedLine | null {
  const at = (f: string) => `lines.${i}.${f}`;
  const rate = parseRupees(l.rate);
  const discount = parseRupees(l.discount);
  const qtyOk = /^\d+(\.\d{1,3})?$/.test(l.qty.trim()) && Number(l.qty) > 0;
  if (!l.description.trim()) errors[at("description")] = "Enter a description";
  if (!qtyOk) errors[at("qty")] = "Enter a quantity";
  if (rate == null) errors[at("ratePaise")] = "Enter a rate";
  if (discount === undefined) errors[at("discountPaise")] = "Enter an amount";
  if (l.gstRateBp === "") errors[at("gstRateBp")] = "Choose GST %";
  if (l.hsn.trim() && !/^\d{4,8}$/.test(l.hsn.trim())) errors[at("hsn")] = "4–8 digits";
  if (!qtyOk || rate == null || discount === undefined || l.gstRateBp === "") return null;
  const taxable = Math.round(rate * Number(l.qty)) - (discount ?? 0);
  if (taxable < 0) {
    errors[at("discountPaise")] = "Discount is more than the line amount";
    return null;
  }
  return {
    id: l.id ?? undefined,
    itemId: l.itemId,
    itemCode: l.itemCode,
    description: l.description,
    hsn: l.hsn,
    uom: l.uom,
    qty: l.qty.trim(),
    ratePaise: rate,
    discountPaise: discount ?? 0,
    gstRateBp: Number(l.gstRateBp),
  };
}

/** Lines that can be priced right now (for the live totals); incomplete ones are skipped. */
export function priceableLines(v: InvoiceFormValues): Array<ParsedLine | null> {
  return v.lines.map((l, i) => (blankLine(l) ? null : parseLine(l, i, {})));
}

/** Live line taxes and totals, same maths as the server. */
export function liveTotals(v: InvoiceFormValues, sellerState: string | null, roundOff: boolean) {
  const parsed = priceableLines(v);
  const good = parsed.filter((l): l is ParsedLine => !!l);
  const pos = placeOfSupply(v);
  const intraState = !!pos && pos === sellerState;
  const r = computeInvoiceTax(
    good.map((l) => ({
      qty: l.qty,
      ratePaise: l.ratePaise,
      discountPaise: l.discountPaise ?? 0,
      gstRateBp: l.gstRateBp,
    })),
    intraState,
    { roundOff },
  );
  let k = 0;
  return {
    intraState,
    placeOfSupply: pos,
    lines: parsed.map((l) => (l ? r.lines[k++] : null)),
    totals: r.totals,
  };
}

export type InvoiceFormResult =
  { ok: true; input: TaxInvoiceInput } | { ok: false; errors: InvoiceFormErrors };

/** Checks the form and builds the data-layer input. Blank line rows are dropped. */
export function formToInvoiceInput(
  v: InvoiceFormValues,
  opts: { imported: boolean; sellerPartyId: string | null },
): InvoiceFormResult {
  const errors: InvoiceFormErrors = {};
  const invoiceAt = istInputToIso(v.invoiceAt);
  if (!invoiceAt) errors.invoiceAt = "Enter the invoice date and time";
  if (opts.imported && !v.invoiceNo.trim()) errors.invoiceNo = "Enter the seller's invoice number";
  if (!v.billTo) errors.billToId = "Choose who the invoice is billed to";
  if (!v.shipSame && !v.shipTo) errors.shipToId = "Choose where the goods are shipped";
  if (!placeOfSupply(v) && shipParty(v)) errors.placeOfSupplyStateCode = "Choose the buyer's state";

  const lines: ParsedLine[] = [];
  v.lines.forEach((l, i) => {
    if (blankLine(l)) return;
    const parsed = parseLine(l, i, errors);
    if (parsed) lines.push(parsed);
  });
  if (!v.lines.some((l) => !blankLine(l))) errors.lines = "Add at least one item";

  if (Object.keys(errors).length || !invoiceAt) return { ok: false, errors };

  return {
    ok: true,
    input: {
      invoiceNo: opts.imported ? v.invoiceNo : undefined,
      invoiceAt,
      sellerPartyId: opts.sellerPartyId,
      billToId: v.billTo!.id,
      shipToId: v.shipSame ? null : v.shipTo!.id,
      placeOfSupplyStateCode: v.placeOfSupply || null,
      customerRef: v.customerRef,
      customerRefDate: v.customerRefDate,
      soNo: v.soNo,
      soDate: v.soDate,
      doNo: v.doNo,
      sapRef: v.sapRef,
      transporterName: v.transporterName,
      truckId: v.truck?.id ?? null,
      driverMobile: v.driverMobile,
      shipFrom: v.shipFrom,
      incoterm: v.incoterm,
      lines,
    },
  };
}

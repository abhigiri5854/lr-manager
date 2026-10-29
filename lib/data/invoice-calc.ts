// Tax invoice rules shared by the mock store and the database (seller state, place of supply,
// line tax and totals). Pure: the caller supplies the company and the parties it needs.
import { partyState } from "@/lib/gst";
import { computeInvoiceTax } from "@/lib/tax";
import type { Company, Party, TaxInvoice, TaxInvoiceLine } from "@/lib/types";
import type { taxInvoiceFields, taxInvoicePatchSchema } from "@/lib/validators/invoice";
import { fail, newId } from "./_store";

export type ParsedInvoiceLine = ReturnType<typeof taxInvoiceFields.parse>["lines"][number];

export type InvoiceHeader = Pick<
  TaxInvoice,
  "sellerPartyId" | "placeOfSupplyStateCode" | "billToId" | "shipToId"
>;

export type InvoiceCtx = {
  company: Pick<Company, "gstin" | "invoiceRoundOff">;
  party: (id: string | null) => Party | undefined;
};

/** Seller's GST state: the seller party's, or this company's when we are the seller. */
export function sellerState(ctx: InvoiceCtx, sellerPartyId: string | null): string | null {
  if (sellerPartyId) return partyState(ctx.party(sellerPartyId));
  return ctx.company.gstin.slice(0, 2);
}

/**
 * Place of supply = ship-to state (bill-to when shipped to the same party). The typed state is only
 * used when that party has none — an unregistered buyer.
 */
export function placeOfSupply(
  ctx: InvoiceCtx,
  h: Pick<InvoiceHeader, "billToId" | "shipToId">,
  typed: string | null,
): string {
  const state = partyState(ctx.party(h.shipToId ?? h.billToId)) ?? typed;
  if (!state) fail("placeOfSupplyStateCode", "Choose the buyer's state");
  return state;
}

/** Day of the invoice in India (invoiceAt is UTC). */
export const invoiceDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** Recalculates every line's tax and the totals from rate × qty. */
export function priceInvoice(
  ctx: InvoiceCtx,
  inv: InvoiceHeader,
  lines: Array<ParsedInvoiceLine | TaxInvoiceLine>,
) {
  const intraState = sellerState(ctx, inv.sellerPartyId) === inv.placeOfSupplyStateCode;
  const input = lines.map((l) => ({ ...l, discountPaise: l.discountPaise ?? 0 }));
  // Round-off is our setting: an imported invoice keeps the seller's own total.
  const tax = computeInvoiceTax(input, intraState, {
    roundOff: !inv.sellerPartyId && ctx.company.invoiceRoundOff,
  });
  const out: TaxInvoiceLine[] = input.map((l, i) => ({
    id: l.id ?? newId(),
    lineNo: i + 1,
    itemId: l.itemId ?? null,
    itemCode: l.itemCode ?? null,
    description: l.description,
    hsn: l.hsn ?? null,
    uom: l.uom ?? null,
    qty: l.qty,
    ratePaise: l.ratePaise,
    discountPaise: l.discountPaise,
    gstRateBp: l.gstRateBp,
    ...tax.lines[i],
  }));
  return { lines: out, totals: tax.totals };
}

export const INVOICE_NO_TOO_LONG =
  "Invoice number would be longer than 16 characters — shorten the prefix in Company profile";

export type ParsedInvoicePatch = ReturnType<typeof taxInvoicePatchSchema.parse>;

/**
 * The draft with the patch applied (before re-pricing), and the typed place of supply that
 * placeOfSupply() falls back to.
 */
export function applyInvoicePatch(
  current: TaxInvoice,
  p: ParsedInvoicePatch,
): { next: TaxInvoice; typed: string | null } {
  if (current.status === "final") fail("", "Finalised invoices can't be edited");
  const { lines, placeOfSupplyStateCode, sellerPartyId, invoiceNo, ...fields } = p;
  void lines;
  void sellerPartyId; // who the seller is never changes after the invoice is created
  const next: TaxInvoice = {
    ...current,
    ...fields,
    invoiceNo: current.sellerPartyId
      ? invoiceNo === undefined
        ? current.invoiceNo
        : invoiceNo
      : null,
  } as TaxInvoice;
  assertImportedHasNo(next);
  const typed =
    placeOfSupplyStateCode === undefined
      ? current.placeOfSupplyStateCode
      : (placeOfSupplyStateCode ?? null);
  return { next, typed };
}

/** Imported invoices carry the seller's own number. */
export function assertImportedHasNo(inv: Pick<TaxInvoice, "invoiceNo" | "sellerPartyId">) {
  if (inv.sellerPartyId && !inv.invoiceNo) fail("invoiceNo", "Enter the seller's invoice number");
}

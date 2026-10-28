import { companySnapshot, partySnapshot } from "@/lib/snapshots";
import { computeInvoiceTax } from "@/lib/tax";
import type { LrView, Page, TaxInvoice, TaxInvoiceLine } from "@/lib/types";
import {
  taxInvoiceFields,
  taxInvoicePatchSchema,
  type TaxInvoiceInput,
  type TaxInvoicePatch,
} from "@/lib/validators/invoice";
import { toLrView } from "./_derive";
import {
  assertRef,
  cancelRecord,
  clone,
  db,
  fail,
  findById,
  insertRecord,
  matchesSearch,
  newId,
  now,
  paginate,
  parseInput,
  scoped,
  updateRecord,
  type ListParams,
} from "./_store";

export type TaxInvoiceListParams = ListParams & {
  status?: TaxInvoice["status"];
  /** Seller, bill-to or ship-to. */
  partyId?: string;
};

type ParsedLine = ReturnType<typeof taxInvoiceFields.parse>["lines"][number];
type Header = Pick<TaxInvoice, "companyId" | "sellerPartyId" | "placeOfSupplyStateCode">;

/** Seller's GST state: the seller party's, or this company's when we are the seller. */
function sellerState(inv: Header): string | null {
  if (inv.sellerPartyId) {
    const p = db.parties.find((x) => x.id === inv.sellerPartyId);
    return p?.stateCode ?? p?.gstin?.slice(0, 2) ?? null;
  }
  return db.companies.find((c) => c.id === inv.companyId)?.gstin.slice(0, 2) ?? null;
}

/** Recalculates every line's tax and the totals from rate × qty. */
function priced(inv: Header, lines: ParsedLine[]) {
  const intraState = sellerState(inv) === inv.placeOfSupplyStateCode;
  const input = lines.map((l) => ({ ...l, discountPaise: l.discountPaise ?? 0 }));
  const tax = computeInvoiceTax(input, intraState);
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

function assertInvoiceRefs(companyId: string, v: ReturnType<typeof taxInvoicePatchSchema.parse>) {
  assertRef(db.parties, companyId, v.sellerPartyId, "sellerPartyId", "Seller");
  assertRef(db.parties, companyId, v.billToId, "billToId", "Bill-to party");
  assertRef(db.parties, companyId, v.shipToId, "shipToId", "Ship-to party");
  assertRef(db.trucks, companyId, v.truckId, "truckId", "Truck");
  v.lines?.forEach((l, i) => assertRef(db.items, companyId, l.itemId, `lines.${i}.itemId`, "Item"));
}

function assertUniqueNo(
  companyId: string,
  inv: Pick<TaxInvoice, "invoiceNo" | "sellerPartyId">,
  exceptId?: string,
) {
  const clash = scoped(db.taxInvoices, companyId).some(
    (x) =>
      x.invoiceNo === inv.invoiceNo && x.sellerPartyId === inv.sellerPartyId && x.id !== exceptId,
  );
  if (clash) fail("invoiceNo", `Invoice ${inv.invoiceNo} from this seller is already saved`);
}

export async function listTaxInvoices(
  companyId: string,
  params: TaxInvoiceListParams = {},
): Promise<Page<TaxInvoice>> {
  const name = (id: string | null) => (id ? db.parties.find((p) => p.id === id)?.name : undefined);
  const rows = scoped(db.taxInvoices, companyId)
    .filter((i) => !params.status || i.status === params.status)
    .filter(
      (i) => !params.partyId || [i.sellerPartyId, i.billToId, i.shipToId].includes(params.partyId),
    )
    .filter((i) =>
      matchesSearch(params.search, i.invoiceNo, name(i.sellerPartyId), name(i.billToId)),
    )
    .sort((a, b) => b.invoiceAt.localeCompare(a.invoiceAt))
    .map(clone);
  return paginate(rows, params);
}

export async function getTaxInvoiceById(companyId: string, id: string): Promise<TaxInvoice | null> {
  const i = findById(db.taxInvoices, companyId, id);
  return i ? clone(i) : null;
}

/** LRs that carry this invoice (the link lives on Lr.lrInvoices). */
export async function listLrsForInvoice(companyId: string, invoiceId: string): Promise<LrView[]> {
  return scoped(db.lrs, companyId)
    .filter((lr) => lr.lrInvoices.some((i) => i.taxInvoiceId === invoiceId))
    .map(toLrView);
}

/** Saves a draft tax invoice; line taxes and totals are always recalculated here. */
export async function createTaxInvoice(
  companyId: string,
  input: TaxInvoiceInput,
): Promise<TaxInvoice> {
  const v = parseInput(taxInvoiceFields, input);
  assertInvoiceRefs(companyId, v);
  const header = {
    companyId,
    sellerPartyId: v.sellerPartyId ?? null,
    placeOfSupplyStateCode: v.placeOfSupplyStateCode,
  };
  assertUniqueNo(companyId, { invoiceNo: v.invoiceNo, sellerPartyId: header.sellerPartyId });
  const t = now();
  const invoice: TaxInvoice = {
    id: newId(),
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...header,
    invoiceNo: v.invoiceNo,
    invoiceAt: v.invoiceAt,
    status: "draft",
    billToId: v.billToId,
    shipToId: v.shipToId ?? null,
    customerRef: v.customerRef ?? null,
    customerRefDate: v.customerRefDate ?? null,
    soNo: v.soNo ?? null,
    soDate: v.soDate ?? null,
    doNo: v.doNo ?? null,
    sapRef: v.sapRef ?? null,
    truckId: v.truckId ?? null,
    driverMobile: v.driverMobile ?? null,
    shipFrom: v.shipFrom ?? null,
    incoterm: v.incoterm ?? null,
    ...priced(header, v.lines),
    irn: v.irn ?? null,
    ewayBillNo: v.ewayBillNo ?? null,
    sourceFileUrl: v.sourceFileUrl ?? null,
    importBatchId: v.importBatchId ?? null,
    snapshot: null,
  };
  return insertRecord("tax_invoices", db.taxInvoices, invoice);
}

export async function updateTaxInvoice(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: TaxInvoicePatch,
): Promise<TaxInvoice> {
  const p = parseInput(taxInvoicePatchSchema, patch);
  assertInvoiceRefs(companyId, p);
  return updateRecord(
    "tax_invoices",
    db.taxInvoices,
    companyId,
    id,
    expectedVersion,
    (current) => {
      if (current.status === "final")
        fail("", "Finalised invoices can't be edited — cancel and re-issue");
      const { lines, ...fields } = p;
      const next: TaxInvoice = { ...current, ...fields };
      assertUniqueNo(companyId, next, id);
      // Re-price whenever lines, seller or place of supply changed.
      const repriced = priced(next, lines ?? current.lines);
      return { ...next, ...repriced };
    },
    "Tax invoice",
  );
}

/** Draft → final: stores the seller / buyer snapshot. */
export async function finaliseTaxInvoice(
  companyId: string,
  id: string,
  expectedVersion: number,
): Promise<TaxInvoice> {
  return updateRecord(
    "tax_invoices",
    db.taxInvoices,
    companyId,
    id,
    expectedVersion,
    (current) => {
      if (current.status === "final") fail("", "Invoice is already final");
      const party = (pid: string) => partySnapshot(db.parties.find((p) => p.id === pid)!);
      const company = db.companies.find((c) => c.id === companyId)!;
      return {
        ...current,
        status: "final" as const,
        snapshot: {
          seller: current.sellerPartyId ? party(current.sellerPartyId) : companySnapshot(company),
          billTo: party(current.billToId),
          shipTo: current.shipToId ? party(current.shipToId) : null,
        },
      };
    },
    "Tax invoice",
  );
}

export async function cancelTaxInvoice(companyId: string, id: string): Promise<TaxInvoice> {
  return cancelRecord("tax_invoices", db.taxInvoices, companyId, id, "Tax invoice");
}

import { financialYear } from "@/lib/fy";
import { partyState } from "@/lib/gst";
import { invoiceStatus } from "@/lib/invoice-status";
import { companySnapshot, partySnapshot } from "@/lib/snapshots";
import { computeInvoiceTax } from "@/lib/tax";
import type {
  Company,
  LrView,
  Page,
  Party,
  TaxInvoice,
  TaxInvoiceLine,
  TaxInvoiceRow,
  TaxInvoiceStatus,
} from "@/lib/types";
import {
  cancelReasonSchema,
  formatInvoiceNo,
  taxInvoiceFields,
  taxInvoicePatchSchema,
  type TaxInvoiceInput,
  type TaxInvoicePatch,
} from "@/lib/validators/invoice";
import { toLrView } from "./_derive";
import {
  allocateNumber,
  assertRef,
  cancelRecord,
  clone,
  db,
  fail,
  findById,
  peekNumber,
  insertRecord,
  matchesSearch,
  newId,
  now,
  paginate,
  parseInput,
  scoped,
  updateRecord,
  writeAudit,
  type ListParams,
} from "./_store";

export type TaxInvoiceListParams = ListParams & {
  status?: TaxInvoiceStatus;
  /** Seller, bill-to or ship-to. */
  partyId?: string;
  /** Invoice date range, yyyy-mm-dd inclusive (India date). */
  from?: string;
  to?: string;
};

type ParsedLine = ReturnType<typeof taxInvoiceFields.parse>["lines"][number];
type Header = Pick<
  TaxInvoice,
  "companyId" | "sellerPartyId" | "placeOfSupplyStateCode" | "billToId" | "shipToId"
>;

const company = (companyId: string): Company => db.companies.find((c) => c.id === companyId)!;
const partyById = (id: string | null): Party | undefined =>
  id ? db.parties.find((p) => p.id === id) : undefined;

/** Seller's GST state: the seller party's, or this company's when we are the seller. */
function sellerState(inv: Pick<Header, "companyId" | "sellerPartyId">): string | null {
  if (inv.sellerPartyId) return partyState(partyById(inv.sellerPartyId));
  return company(inv.companyId).gstin.slice(0, 2);
}

/**
 * Place of supply = ship-to state (bill-to when shipped to the same party). The typed state is only
 * used when that party has none — an unregistered buyer.
 */
function placeOfSupply(h: Omit<Header, "placeOfSupplyStateCode">, typed: string | null): string {
  const state = partyState(partyById(h.shipToId ?? h.billToId)) ?? typed;
  if (!state) fail("placeOfSupplyStateCode", "Choose the buyer's state");
  return state;
}

/** Day of the invoice in India (invoiceAt is UTC). */
const invoiceDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** Recalculates every line's tax and the totals from rate × qty. */
function priced(inv: Header, lines: Array<ParsedLine | TaxInvoiceLine>) {
  const intraState = sellerState(inv) === inv.placeOfSupplyStateCode;
  const input = lines.map((l) => ({ ...l, discountPaise: l.discountPaise ?? 0 }));
  // Round-off is our setting: an imported invoice keeps the seller's own total.
  const tax = computeInvoiceTax(input, intraState, {
    roundOff: !inv.sellerPartyId && company(inv.companyId).invoiceRoundOff,
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

function assertInvoiceRefs(companyId: string, v: ReturnType<typeof taxInvoicePatchSchema.parse>) {
  assertRef(db.parties, companyId, v.sellerPartyId, "sellerPartyId", "Seller");
  assertRef(db.parties, companyId, v.billToId, "billToId", "Bill-to party");
  assertRef(db.parties, companyId, v.shipToId, "shipToId", "Ship-to party");
  assertRef(db.trucks, companyId, v.truckId, "truckId", "Truck");
  v.lines?.forEach((l, i) => assertRef(db.items, companyId, l.itemId, `lines.${i}.itemId`, "Item"));
}

/** Invoice numbers are unique per seller and financial year (cancelled ones still hold theirs). */
function assertUniqueNo(
  companyId: string,
  inv: Pick<TaxInvoice, "invoiceNo" | "sellerPartyId" | "invoiceAt">,
  exceptId?: string,
) {
  if (!inv.invoiceNo) return;
  const fy = financialYear(invoiceDay(inv.invoiceAt));
  const clash = scoped(db.taxInvoices, companyId, true).some(
    (x) =>
      x.invoiceNo === inv.invoiceNo &&
      x.sellerPartyId === inv.sellerPartyId &&
      x.id !== exceptId &&
      financialYear(invoiceDay(x.invoiceAt)) === fy,
  );
  if (clash) fail("invoiceNo", `Invoice ${inv.invoiceNo} is already used in FY ${fy}`);
}

/** Imported invoices carry the seller's own number. */
function assertImportedHasNo(inv: Pick<TaxInvoice, "invoiceNo" | "sellerPartyId">) {
  if (inv.sellerPartyId && !inv.invoiceNo) fail("invoiceNo", "Enter the seller's invoice number");
}

function toRow(i: TaxInvoice): TaxInvoiceRow {
  const billTo = i.snapshot?.billTo ?? partyById(i.billToId);
  return {
    ...clone(i),
    displayStatus: invoiceStatus(i),
    billToName: billTo?.name ?? "",
    billToGstin: billTo?.gstin ?? null,
    linkedLrs: scoped(db.lrs, i.companyId)
      .filter((lr) => lr.lrInvoices.some((x) => x.taxInvoiceId === i.id))
      .map((lr) => ({ id: lr.id, lrNo: lr.lrNo })),
  };
}

export async function listTaxInvoices(
  companyId: string,
  params: TaxInvoiceListParams = {},
): Promise<Page<TaxInvoiceRow>> {
  const rows = scoped(db.taxInvoices, companyId, true)
    .filter((i) => !params.status || invoiceStatus(i) === params.status)
    .filter(
      (i) => !params.partyId || [i.sellerPartyId, i.billToId, i.shipToId].includes(params.partyId),
    )
    .filter((i) => !params.from || invoiceDay(i.invoiceAt) >= params.from)
    .filter((i) => !params.to || invoiceDay(i.invoiceAt) <= params.to)
    .map(toRow)
    .filter((r) =>
      matchesSearch(
        params.search,
        r.invoiceNo,
        r.billToName,
        r.billToGstin,
        partyById(r.sellerPartyId)?.name,
      ),
    )
    .sort((a, b) => b.invoiceAt.localeCompare(a.invoiceAt));
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

/** The number the next own invoice dated `date` would get (not reserved). */
export async function peekNextInvoiceNo(
  companyId: string,
  date: string,
): Promise<{ invoiceNo: string | null; fy: string; counter: number }> {
  const fy = financialYear(date);
  const counter = peekNumber(companyId, "tax_invoice", fy) ?? 1;
  return { invoiceNo: formatInvoiceNo(company(companyId).taxInvoicePrefix, counter), fy, counter };
}

/** Saves a draft tax invoice; line taxes and totals are always recalculated here. */
export async function createTaxInvoice(
  companyId: string,
  input: TaxInvoiceInput,
): Promise<TaxInvoice> {
  const v = parseInput(taxInvoiceFields, input);
  assertInvoiceRefs(companyId, v);
  const sellerPartyId = v.sellerPartyId ?? null;
  // Own invoices get their number on Finalise only.
  const invoiceNo = sellerPartyId ? (v.invoiceNo ?? null) : null;
  assertImportedHasNo({ invoiceNo, sellerPartyId });
  assertUniqueNo(companyId, { invoiceNo, sellerPartyId, invoiceAt: v.invoiceAt });
  const parties = { companyId, sellerPartyId, billToId: v.billToId, shipToId: v.shipToId ?? null };
  const header: Header = {
    ...parties,
    placeOfSupplyStateCode: placeOfSupply(parties, v.placeOfSupplyStateCode ?? null),
  };
  const t = now();
  const invoice: TaxInvoice = {
    id: newId(),
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...header,
    invoiceNo,
    invoiceAt: v.invoiceAt,
    status: "draft",
    customerRef: v.customerRef ?? null,
    customerRefDate: v.customerRefDate ?? null,
    soNo: v.soNo ?? null,
    soDate: v.soDate ?? null,
    doNo: v.doNo ?? null,
    sapRef: v.sapRef ?? null,
    transporterName: v.transporterName ?? null,
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

/** Draft edits only. Own drafts never take a number here; imported ones may correct theirs. */
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
      if (current.status === "final") fail("", "Finalised invoices can't be edited");
      const { lines, placeOfSupplyStateCode, sellerPartyId, invoiceNo, ...fields } = p;
      void sellerPartyId; // who the seller is never changes after the invoice is created
      const next: TaxInvoice = {
        ...current,
        ...fields,
        invoiceNo: current.sellerPartyId
          ? invoiceNo === undefined
            ? current.invoiceNo
            : invoiceNo
          : null,
      };
      assertImportedHasNo(next);
      assertUniqueNo(companyId, next, id);
      const typed =
        placeOfSupplyStateCode === undefined
          ? current.placeOfSupplyStateCode
          : placeOfSupplyStateCode;
      next.placeOfSupplyStateCode = placeOfSupply(next, typed);
      // Re-price every save: lines, parties or place of supply may have changed.
      return { ...next, ...priced(next, lines ?? current.lines) };
    },
    "Tax invoice",
  );
}

/**
 * Draft → final: locks the invoice and stores the seller / buyer snapshot. Own invoices take the
 * next number from the company + FY tax-invoice series (checked before it is taken, so a failure
 * never leaves a gap). Imported invoices keep the seller's number.
 */
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
      const co = company(companyId);
      let invoiceNo = current.invoiceNo;
      if (!current.sellerPartyId) {
        const fy = financialYear(invoiceDay(current.invoiceAt));
        const next = peekNumber(companyId, "tax_invoice", fy) ?? 1;
        invoiceNo = formatInvoiceNo(co.taxInvoicePrefix, next);
        if (!invoiceNo) {
          fail(
            "invoiceNo",
            "Invoice number would be longer than 16 characters — shorten the prefix in Company profile",
          );
        }
        assertUniqueNo(companyId, { ...current, invoiceNo }, id);
        allocateNumber(companyId, "tax_invoice", fy);
      }
      const party = (pid: string) => partySnapshot(partyById(pid)!);
      // Items remember the last rate they were sold at.
      for (const l of current.lines) {
        const item = l.itemId ? findById(db.items, companyId, l.itemId) : undefined;
        if (item && item.lastRatePaise !== l.ratePaise) {
          const before = clone(item);
          item.lastRatePaise = l.ratePaise;
          writeAudit(companyId, "items", item.id, "update", before, item);
        }
      }
      return {
        ...current,
        invoiceNo,
        status: "final" as const,
        snapshot: {
          seller: current.sellerPartyId ? party(current.sellerPartyId) : companySnapshot(co),
          billTo: party(current.billToId),
          shipTo: current.shipToId ? party(current.shipToId) : null,
        },
      };
    },
    "Tax invoice",
  );
}

/** Cancels a draft or final invoice. The number stays used; the invoice shows as CANCELLED. */
export async function cancelTaxInvoice(
  companyId: string,
  id: string,
  reason: string,
): Promise<TaxInvoice> {
  const cancelReason = parseInput(cancelReasonSchema, reason);
  return cancelRecord("tax_invoices", db.taxInvoices, companyId, id, "Tax invoice", {
    cancelReason,
  });
}

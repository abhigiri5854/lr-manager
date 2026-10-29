import { financialYear } from "@/lib/fy";
import { invoiceStatus } from "@/lib/invoice-status";
import { companySnapshot, partySnapshot } from "@/lib/snapshots";
import type {
  Company,
  LrView,
  Page,
  Party,
  TaxInvoice,
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
  authorStamp,
} from "./_store";
import * as dbi from "./db/invoices";
import {
  applyInvoicePatch,
  assertImportedHasNo,
  INVOICE_NO_TOO_LONG,
  invoiceDay,
  placeOfSupply,
  priceInvoice,
  type InvoiceCtx,
  type InvoiceHeader,
} from "./invoice-calc";
import { assertCan } from "./session";
import { onDatabase } from "./source";

export type TaxInvoiceListParams = ListParams & {
  status?: TaxInvoiceStatus;
  /** Seller, bill-to or ship-to. */
  partyId?: string;
  /** Invoice date range, yyyy-mm-dd inclusive (India date). */
  from?: string;
  to?: string;
};

const company = (companyId: string): Company => db.companies.find((c) => c.id === companyId)!;
const partyById = (id: string | null): Party | undefined =>
  id ? db.parties.find((p) => p.id === id) : undefined;
const ctxFor = (companyId: string): InvoiceCtx => ({
  company: company(companyId),
  party: partyById,
});

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
  if (onDatabase()) return dbi.listTaxInvoices(companyId, params);
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
  if (onDatabase()) return dbi.getTaxInvoiceById(companyId, id);
  const i = findById(db.taxInvoices, companyId, id);
  return i ? clone(i) : null;
}

/** LRs that carry this invoice (the link lives on Lr.lrInvoices). */
export async function listLrsForInvoice(companyId: string, invoiceId: string): Promise<LrView[]> {
  if (onDatabase()) return dbi.listLrsForInvoice(companyId, invoiceId);
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
  if (onDatabase()) {
    const { prefix, counter } = await dbi.peekInvoiceCounter(companyId, fy);
    return { invoiceNo: formatInvoiceNo(prefix, counter), fy, counter };
  }
  const counter = peekNumber(companyId, "tax_invoice", fy) ?? 1;
  return { invoiceNo: formatInvoiceNo(company(companyId).taxInvoicePrefix, counter), fy, counter };
}

/** Saves a draft tax invoice; line taxes and totals are always recalculated here. */
export async function createTaxInvoice(
  companyId: string,
  input: TaxInvoiceInput,
): Promise<TaxInvoice> {
  await assertCan(companyId, "invoice.edit");
  const v = parseInput(taxInvoiceFields, input);
  if (onDatabase()) return dbi.insertTaxInvoice(companyId, v);
  assertInvoiceRefs(companyId, v);
  const sellerPartyId = v.sellerPartyId ?? null;
  // Own invoices get their number on Finalise only.
  const invoiceNo = sellerPartyId ? (v.invoiceNo ?? null) : null;
  assertImportedHasNo({ invoiceNo, sellerPartyId });
  assertUniqueNo(companyId, { invoiceNo, sellerPartyId, invoiceAt: v.invoiceAt });
  const parties = { sellerPartyId, billToId: v.billToId, shipToId: v.shipToId ?? null };
  const ctx = ctxFor(companyId);
  const header: InvoiceHeader = {
    ...parties,
    placeOfSupplyStateCode: placeOfSupply(ctx, parties, v.placeOfSupplyStateCode ?? null),
  };
  const t = now();
  const invoice: TaxInvoice = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...authorStamp(),
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
    ...priceInvoice(ctx, header, v.lines),
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
  await assertCan(companyId, "invoice.edit");
  const p = parseInput(taxInvoicePatchSchema, patch);
  if (onDatabase()) return dbi.updateTaxInvoice(companyId, id, expectedVersion, p);
  assertInvoiceRefs(companyId, p);
  return updateRecord(
    "tax_invoices",
    db.taxInvoices,
    companyId,
    id,
    expectedVersion,
    (current) => {
      const { next, typed } = applyInvoicePatch(current, p);
      assertUniqueNo(companyId, next, id);
      const ctx = ctxFor(companyId);
      next.placeOfSupplyStateCode = placeOfSupply(ctx, next, typed);
      // Re-price every save: lines, parties or place of supply may have changed.
      return { ...next, ...priceInvoice(ctx, next, p.lines ?? current.lines) };
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
  await assertCan(companyId, "invoice.edit");
  if (onDatabase()) return dbi.finaliseTaxInvoice(companyId, id, expectedVersion);
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
        if (!invoiceNo) fail("invoiceNo", INVOICE_NO_TOO_LONG);
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
  await assertCan(companyId, "record.cancel");
  const cancelReason = parseInput(cancelReasonSchema, reason);
  if (onDatabase()) return dbi.cancelTaxInvoice(companyId, id, cancelReason);
  return cancelRecord("tax_invoices", db.taxInvoices, companyId, id, "Tax invoice", {
    cancelReason,
  });
}

import type { InvoiceMeta, LinkedLr } from "@/components/invoices/InvoiceForm";
import { getCompany } from "@/lib/data/companies";
import { listLrsForInvoice, peekNextInvoiceNo } from "@/lib/data/invoices";
import { getPartyById } from "@/lib/data/parties";
import { getTruckById } from "@/lib/data/trucks";
import { todayInIndia } from "@/lib/fy";
import { partyState } from "@/lib/gst";
import { invoiceStatus } from "@/lib/invoice-status";
import type { PartyOption, TruckOption } from "@/lib/lr-form";
import type { Party, PartySnapshot, TaxInvoice } from "@/lib/types";

// Server-side loading shared by /invoices/new and /invoices/[id].

const toOption = (p: Party | PartySnapshot): PartyOption => ({
  id: p.id,
  name: p.name,
  place: p.place,
  gstin: p.gstin,
  phone: p.phone,
  address: p.address,
  stateCode: p.stateCode,
});

async function partyOption(
  companyId: string,
  id: string | null,
  snap?: PartySnapshot | null,
): Promise<PartyOption | null> {
  if (snap) return toOption(snap);
  const p = id ? await getPartyById(companyId, id) : null;
  return p ? toOption(p) : null;
}

/** The seller block: this company, or the consignor for an imported invoice. */
export async function loadSeller(companyId: string, inv: TaxInvoice | null) {
  if (inv?.sellerPartyId) {
    const snap = inv.snapshot?.seller as PartySnapshot | undefined;
    const p = snap ?? (await getPartyById(companyId, inv.sellerPartyId));
    return {
      name: p?.name ?? "Unknown seller",
      gstin: p?.gstin ?? null,
      state: partyState(p),
      partyId: inv.sellerPartyId,
    };
  }
  const company = await getCompany(companyId);
  const c = inv?.snapshot?.seller ?? company;
  return {
    name: company?.label ?? c?.name ?? "",
    gstin: c?.gstin ?? null,
    state: c?.gstin?.slice(0, 2) ?? null,
    partyId: null,
  };
}

export async function loadCompanyInvoiceSettings(companyId: string) {
  const [company, next] = await Promise.all([
    getCompany(companyId),
    peekNextInvoiceNo(companyId, todayInIndia()),
  ]);
  return { roundOff: company?.invoiceRoundOff ?? true, nextInvoiceNo: next.invoiceNo };
}

export async function loadInvoicePicked(companyId: string, inv: TaxInvoice) {
  const [billTo, shipTo, truck] = await Promise.all([
    partyOption(companyId, inv.billToId, inv.snapshot?.billTo),
    partyOption(companyId, inv.shipToId, inv.snapshot?.shipTo),
    inv.truckId ? getTruckById(companyId, inv.truckId) : null,
  ]);
  const truckOption: TruckOption | null = truck
    ? { id: truck.id, number: truck.number, driverMobile: truck.driverMobile, lastLrNo: null }
    : null;
  return { billTo, shipTo, truck: truckOption };
}

export async function loadLinkedLrs(companyId: string, invoiceId: string): Promise<LinkedLr[]> {
  const lrs = await listLrsForInvoice(companyId, invoiceId);
  return lrs.map((l) => ({ id: l.id, lrNo: l.lrNo, status: l.status, lrDate: l.lrDate }));
}

export function invoiceMeta(inv: TaxInvoice, sellerState: string | null): InvoiceMeta {
  return {
    id: inv.id,
    version: inv.version,
    status: invoiceStatus(inv),
    invoiceNo: inv.invoiceNo,
    cancelReason: inv.cancelReason ?? null,
    sourceFileUrl: inv.sourceFileUrl,
    importBatchId: inv.importBatchId,
    ewayBillNo: inv.ewayBillNo,
    lines: inv.lines.map((l) => ({
      taxablePaise: l.taxablePaise,
      sgstPaise: l.sgstPaise,
      cgstPaise: l.cgstPaise,
      igstPaise: l.igstPaise,
    })),
    totals: inv.totals,
    intraState: sellerState === inv.placeOfSupplyStateCode,
  };
}

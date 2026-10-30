// lib/types (camelCase, nested) → table rows (snake_case columns, flat). Used by the seed now and
// by lib/data once it moves to Postgres. *Url fields become Storage *_path (null for sample data).
import { financialYear } from "@/lib/fy";
import type {
  BaseRecord,
  Company,
  Driver,
  Item,
  Lr,
  Membership,
  Party,
  TaxInvoice,
  Truck,
  User,
} from "@/lib/types";
import type * as s from "./schema";

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

/** Columns every business row shares. */
function base(r: BaseRecord) {
  return {
    id: r.id,
    companyId: r.companyId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    cancelledAt: r.cancelledAt ?? null,
    cancelReason: r.cancelReason ?? null,
    version: r.version,
  };
}

/** Number part of a document number after its prefix ("ACM/FB/26-27/007" → 7). */
export function sequenceOf(no: string, prefix: string): number | null {
  const rest = no.startsWith(prefix) ? no.slice(prefix.length) : no;
  return /^\d+$/.test(rest) ? Number(rest) : null;
}

export function userRow(u: User): Insert<typeof s.users> {
  return {
    id: u.id,
    name: u.name,
    mobile: u.mobile,
    email: u.email,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    cancelledAt: u.cancelledAt ?? null,
  };
}

export function companyRow(c: Company): Insert<typeof s.companies> {
  return {
    id: c.id,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    cancelledAt: c.cancelledAt ?? null,
    version: c.version,
    code: c.code,
    label: c.label,
    name: c.name,
    city: c.city,
    office: c.office,
    email: c.email,
    website: c.website,
    mobile1: c.mobile1,
    mobile2: c.mobile2,
    gstin: c.gstin,
    pan: c.pan,
    udyam: c.udyam,
    bankAccountName: c.bank?.accountName ?? null,
    bankName: c.bank?.bankName ?? null,
    bankAccountNo: c.bank?.accountNo ?? null,
    bankIfsc: c.bank?.ifsc ?? null,
    invoiceTitle: c.invoiceTitle,
    invoiceNote: c.invoiceNote,
    freightBillPrefix: c.freightBillPrefix,
    taxInvoicePrefix: c.taxInvoicePrefix,
    invoiceRoundOff: c.invoiceRoundOff,
    numberingResetsYearly: c.numberingResetsYearly,
    freightGstRateBp: c.freightGstRateBp,
    signatoryName: c.signatoryName,
    lrPrefix: c.lrPrefix,
    jurisdiction: c.jurisdiction,
    podDays: c.podDays,
    podPenaltyPerDayPaise: c.podPenaltyPerDay,
    lrCopies: c.lrCopies,
    detention: c.detention,
    lrTerms: c.lrTerms,
    logoPath: null,
    useLogoWatermark: c.useLogoWatermark,
    signaturePath: null,
  };
}

export function membershipRow(m: Membership): Insert<typeof s.memberships> {
  return { ...base(m), userId: m.userId, role: m.role };
}

export function partyRow(p: Party): Insert<typeof s.parties> {
  return {
    ...base(p),
    name: p.name,
    place: p.place,
    gstin: p.gstin,
    pan: p.pan,
    phone: p.phone,
    address: p.address,
    stateCode: p.stateCode,
    pincode: p.pincode,
    logoPath: null,
    defaultFrom: p.defaultFrom,
    defaultPaymentMode: p.defaultPaymentMode,
    defaultGstPayer: p.defaultGstPayer,
    defaultChargedAs: p.defaultChargedAs,
    source: p.source,
    isSelf: p.isSelf,
  };
}

export function driverRow(d: Driver): Insert<typeof s.drivers> {
  return {
    ...base(d),
    mobile: d.mobile,
    name: d.name,
    licenceNo: d.licenceNo,
    licenceExpiry: d.licenceExpiry,
    userId: d.userId,
    invitedAt: d.invitedAt,
  };
}

export function truckRow(t: Truck): Insert<typeof s.trucks> {
  return {
    ...base(t),
    number: t.number,
    driverId: t.driverId,
    rcExpiry: t.rcExpiry,
    insuranceExpiry: t.insuranceExpiry,
    permitExpiry: t.permitExpiry,
    fitnessExpiry: t.fitnessExpiry,
    source: t.source,
  };
}

export function itemRow(i: Item): Insert<typeof s.items> {
  return {
    ...base(i),
    code: i.code,
    name: i.name,
    hsn: i.hsn,
    uom: i.uom,
    gstRateBp: i.gstRateBp,
    lastRatePaise: i.lastRatePaise,
  };
}

export function taxInvoiceRows(t: TaxInvoice, company: Company) {
  const own = t.sellerPartyId === null;
  const fy = financialYear(t.invoiceAt);
  const invoice: Insert<typeof s.taxInvoices> = {
    ...base(t),
    invoiceNo: t.invoiceNo,
    invoiceFy: fy,
    invoiceSeq: own && t.invoiceNo ? sequenceOf(t.invoiceNo, company.taxInvoicePrefix) : null,
    invoiceAt: t.invoiceAt,
    status: t.status,
    sellerPartyId: t.sellerPartyId,
    billToId: t.billToId,
    shipToId: t.shipToId,
    placeOfSupplyStateCode: t.placeOfSupplyStateCode,
    customerRef: t.customerRef,
    customerRefDate: t.customerRefDate,
    soNo: t.soNo,
    soDate: t.soDate,
    doNo: t.doNo,
    sapRef: t.sapRef,
    transporterName: t.transporterName,
    truckId: t.truckId,
    driverMobile: t.driverMobile,
    shipFrom: t.shipFrom,
    incoterm: t.incoterm,
    irn: t.irn,
    ewayBillNo: t.ewayBillNo,
    sourceFilePath: null,
    importBatchId: t.importBatchId,
    snapshot: t.snapshot,
    ...t.totals,
  };
  const lines: Insert<typeof s.taxInvoiceLines>[] = t.lines.map((l) => ({
    ...l,
    companyId: t.companyId,
    taxInvoiceId: t.id,
  }));
  return { invoice, lines };
}

export function lrRows(lr: Lr, company: Company) {
  const c = lr.charges;
  const row: Insert<typeof s.lrs> = {
    ...base(lr),
    importBatchId: lr.importBatchId ?? null,
    lrNo: lr.lrNo,
    lrFy: financialYear(lr.lrDate ?? lr.createdAt),
    lrSeq: sequenceOf(lr.lrNo, company.lrPrefix),
    lrDate: lr.lrDate,
    fromPlace: lr.fromPlace,
    toPlace: lr.toPlace,
    risk: lr.risk,
    consignorId: lr.consignorId,
    consigneeId: lr.consigneeId,
    billedToId: lr.billedToId,
    gstPaidBy: lr.gstPaidBy,
    paymentMode: lr.paymentMode,
    chargedAs: lr.chargedAs,
    ratePaise: lr.ratePaise,
    truckId: lr.truckId,
    driverMobile: lr.driverMobile,
    remarks: lr.remarks,
    freightPaise: c.freight,
    packingPaise: c.packing,
    cnChargePaise: c.cnCharge,
    loadingPaise: c.loading,
    unloadingPaise: c.unloading,
    detentionPaise: c.detention,
    otherPaise: c.other,
    gstPaise: c.gst,
    advancePaise: c.advance,
    bookedAt: lr.bookedAt,
    dispatchedAt: lr.dispatchedAt,
    deliveredAt: lr.deliveredAt,
    podReceivedAt: lr.podReceivedAt,
    billedAt: lr.billedAt,
    paidAt: lr.paidAt,
    snapshot: lr.snapshot,
  };
  const items: Insert<typeof s.lrItems>[] = lr.items.map((i, position) => ({
    ...i,
    companyId: lr.companyId,
    lrId: lr.id,
    position,
  }));
  const invoices: Insert<typeof s.lrInvoices>[] = lr.lrInvoices.map((i, position) => ({
    ...i,
    companyId: lr.companyId,
    lrId: lr.id,
    position,
  }));
  return { lr: row, items, invoices };
}

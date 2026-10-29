// Table rows (snake_case) → the lib/types records screens already use, and the audit writer.
// The reverse direction for the seed lives in db/rows.ts.
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AuditEntry,
  Company,
  Driver,
  FreightBill,
  FreightBillLine,
  ImportBatch,
  ImportMapping,
  Item,
  Lr,
  LrView,
  Membership,
  Party,
  Payment,
  PaymentAllocation,
  Pod,
  TaxInvoice,
  TaxInvoiceLine,
  Truck,
  User,
} from "@/lib/types";
import { deriveLrStatus } from "@/lib/lr-status";
import { auditChanges, type TableName } from "../_store";
import { withCommit, type Tx } from "./conn";
import { importUrlFromPath, podUrlFromPath, urlFromPath } from "./storage";

// postgres.js rows are untyped records; each mapper below names every column it reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

function base(r: Row) {
  return {
    id: r.id as string,
    companyId: r.company_id as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    cancelledAt: opt(r.cancelled_at as string | null),
    cancelReason: opt(r.cancel_reason as string | null),
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

/** Drops keys whose value is undefined, so records compare equal to the mock's (audit diffs). */
function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export function toCompany(r: Row, nextLrNo: number | null): Company {
  return clean({
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cancelledAt: opt(r.cancelled_at),
    version: r.version,
    label: r.label,
    name: r.name,
    city: r.city,
    office: r.office,
    email: r.email,
    website: r.website,
    mobile1: r.mobile1,
    mobile2: r.mobile2,
    gstin: r.gstin,
    pan: r.pan,
    udyam: r.udyam,
    bank:
      r.bank_account_name === null
        ? null
        : {
            accountName: r.bank_account_name,
            bankName: r.bank_name,
            accountNo: r.bank_account_no,
            ifsc: r.bank_ifsc,
          },
    invoiceTitle: r.invoice_title,
    invoiceNote: r.invoice_note,
    freightBillPrefix: r.freight_bill_prefix,
    taxInvoicePrefix: r.tax_invoice_prefix,
    invoiceRoundOff: r.invoice_round_off,
    numberingResetsYearly: r.numbering_resets_yearly,
    freightGstRateBp: r.freight_gst_rate_bp,
    signatoryName: r.signatory_name,
    lrPrefix: r.lr_prefix,
    nextLrNo,
    jurisdiction: r.jurisdiction,
    podDays: r.pod_days,
    podPenaltyPerDay: r.pod_penalty_per_day_paise,
    lrCopies: r.lr_copies,
    detention: r.detention,
    lrTerms: r.lr_terms,
    logoUrl: urlFromPath("logos", r.logo_path),
    useLogoWatermark: r.use_logo_watermark,
    signatureUrl: urlFromPath("signatures", r.signature_path),
  });
}

export function toUser(r: Row): User {
  return clean({
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cancelledAt: opt(r.cancelled_at),
    name: r.name,
    mobile: r.mobile,
    email: r.email,
    lastLoginAt: r.last_login_at,
  });
}

export function toMembership(r: Row): Membership {
  return clean({ ...base(r), userId: r.user_id, role: r.role });
}

export function toParty(r: Row): Party {
  return clean({
    ...base(r),
    name: r.name,
    place: r.place,
    gstin: r.gstin,
    pan: r.pan,
    phone: r.phone,
    address: r.address,
    stateCode: r.state_code,
    pincode: r.pincode,
    // Party logos aren't uploaded yet; the column holds a Storage path when they are.
    logoUrl: r.logo_path,
    defaultFrom: r.default_from,
    defaultPaymentMode: r.default_payment_mode,
    defaultGstPayer: r.default_gst_payer,
    defaultChargedAs: r.default_charged_as,
    source: r.source,
    isSelf: r.is_self,
  });
}

export function toTruck(r: Row): Truck {
  return clean({
    ...base(r),
    number: r.number,
    driverId: r.driver_id,
    rcExpiry: r.rc_expiry,
    insuranceExpiry: r.insurance_expiry,
    permitExpiry: r.permit_expiry,
    fitnessExpiry: r.fitness_expiry,
    source: r.source,
  });
}

export function toDriver(r: Row): Driver {
  return clean({
    ...base(r),
    mobile: r.mobile,
    name: r.name,
    licenceNo: r.licence_no,
    licenceExpiry: r.licence_expiry,
    userId: r.user_id,
    invitedAt: r.invited_at,
  });
}

export function toItem(r: Row): Item {
  return clean({
    ...base(r),
    code: r.code,
    name: r.name,
    hsn: r.hsn,
    uom: r.uom,
    gstRateBp: r.gst_rate_bp,
    lastRatePaise: r.last_rate_paise,
  });
}

const isoOrNull = (v: string | null) => (v === null ? null : new Date(v).toISOString());

/** A lrs row plus `items` / `invoices` json (lrViewCols in ./lrs.ts) → the Lr record. */
export function toLr(r: Row): Lr {
  return clean({
    ...base(r),
    importBatchId: opt(r.import_batch_id),
    lrNo: r.lr_no,
    lrDate: r.lr_date,
    fromPlace: r.from_place,
    toPlace: r.to_place,
    risk: r.risk,
    consignorId: r.consignor_id,
    consigneeId: r.consignee_id,
    billedToId: r.billed_to_id,
    gstPaidBy: r.gst_paid_by,
    paymentMode: r.payment_mode,
    chargedAs: r.charged_as,
    ratePaise: r.rate_paise,
    truckId: r.truck_id,
    driverMobile: r.driver_mobile,
    lrInvoices: (r.invoices as Row[]).map((i) => ({
      ...i,
      ewayExpiresAt: isoOrNull(i.ewayExpiresAt),
    })) as Lr["lrInvoices"],
    items: r.items as Lr["items"],
    charges: {
      freight: r.freight_paise,
      packing: r.packing_paise,
      cnCharge: r.cn_charge_paise,
      loading: r.loading_paise,
      unloading: r.unloading_paise,
      detention: r.detention_paise,
      other: r.other_paise,
      gst: r.gst_paise,
      advance: r.advance_paise,
    },
    remarks: r.remarks,
    bookedAt: r.booked_at,
    dispatchedAt: r.dispatched_at,
    deliveredAt: r.delivered_at,
    snapshot: r.snapshot,
    podReceivedAt: r.pod_received_at,
    billedAt: r.billed_at,
    paidAt: r.paid_at,
  });
}

/** toLr + the derived status and display names (r.consignor_name … from the view query). */
export function toLrView(r: Row): LrView {
  const lr = toLr(r);
  const values = lr.lrInvoices.map((i) => i.valuePaise).filter((v): v is number => v !== null);
  const expiries = lr.lrInvoices
    .map((i) => i.ewayExpiresAt)
    .filter((v): v is string => v !== null)
    .sort();
  return {
    ...lr,
    status: deriveLrStatus(lr),
    consignorName: r.consignor_name ?? null,
    consigneeName: r.consignee_name ?? null,
    billedToName: r.billed_to_name ?? null,
    truckNumber: r.truck_number ?? null,
    totalPackages: lr.items.reduce((sum, i) => sum + i.packages, 0),
    totalValuePaise: values.length ? values.reduce((a, b) => a + b, 0) : null,
    ewayExpiresAt: expiries[0] ?? null,
  };
}

export function toPod(r: Row): Pod {
  return clean({
    ...base(r),
    lrId: r.lr_id,
    receivedBy: r.received_by,
    receiverPhone: r.receiver_phone,
    packagesReceived: r.packages_received,
    condition: r.condition,
    remarks: r.remarks,
    documentUrls: (r.document_paths as string[]).map(podUrlFromPath),
    receivedAt: r.received_at,
  });
}

export function toTaxInvoice(r: Row): TaxInvoice {
  return clean({
    ...base(r),
    invoiceNo: r.invoice_no,
    invoiceAt: r.invoice_at,
    status: r.status,
    numberFy: r.status === "final" ? (r.invoice_fy ?? null) : null,
    sellerPartyId: r.seller_party_id,
    billToId: r.bill_to_id,
    shipToId: r.ship_to_id,
    placeOfSupplyStateCode: r.place_of_supply_state_code,
    customerRef: r.customer_ref,
    customerRefDate: r.customer_ref_date,
    soNo: r.so_no,
    soDate: r.so_date,
    doNo: r.do_no,
    sapRef: r.sap_ref,
    transporterName: r.transporter_name,
    truckId: r.truck_id,
    driverMobile: r.driver_mobile,
    shipFrom: r.ship_from,
    incoterm: r.incoterm,
    lines: r.lines as TaxInvoiceLine[],
    totals: {
      taxablePaise: r.taxable_paise,
      sgstPaise: r.sgst_paise,
      cgstPaise: r.cgst_paise,
      igstPaise: r.igst_paise,
      roundOffPaise: r.round_off_paise,
      totalPaise: r.total_paise,
    },
    irn: r.irn,
    qrPayload: r.qr_payload ?? null,
    ewayBillNo: r.eway_bill_no,
    sourceFileUrl: importUrlFromPath(r.source_file_path),
    importBatchId: r.import_batch_id,
    snapshot: r.snapshot,
  });
}

export function toFreightBill(r: Row): FreightBill {
  return clean({
    ...base(r),
    status: r.status,
    billNo: r.bill_no,
    billDate: r.bill_date,
    numberFy: r.bill_fy ?? null,
    partyId: r.party_id,
    gstMode: r.gst_mode,
    gstRateBp: r.gst_rate_bp,
    lines: r.lines as FreightBillLine[],
    totals: {
      chargesPaise: r.charges_paise,
      sgstPaise: r.sgst_paise,
      cgstPaise: r.cgst_paise,
      igstPaise: r.igst_paise,
      advancePaise: r.advance_paise,
      amountPaise: r.amount_paise,
    },
    snapshot: r.snapshot,
  });
}

export function toPayment(r: Row): Payment {
  return clean({
    ...base(r),
    partyId: r.party_id,
    allocations: r.allocations as PaymentAllocation[],
    amountPaise: r.amount_paise,
    tdsPaise: r.tds_paise,
    mode: r.mode,
    receivedOn: r.received_on,
    reference: r.reference,
  });
}

export function toImportBatch(r: Row): ImportBatch {
  return clean({
    ...base(r),
    createdBy: r.created_by,
    source: r.source,
    fileName: r.file_name,
    fileUrl: importUrlFromPath(r.file_path),
    format: r.format,
    kind: r.kind,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    detectedAs: r.detected_as,
    status: r.status,
    error: r.error,
    result: r.result,
    mapping: r.mapping,
    confirmedColumns: r.confirmed_columns,
    mappingName: r.mapping_name,
    rowActions: r.row_actions,
    counts: { valid: r.count_valid, warning: r.count_warning, error: r.count_error },
    createdRecords: r.created_records,
    importedAt: r.imported_at,
  });
}

export function toImportMapping(r: Row): ImportMapping {
  return clean({ ...base(r), name: r.name, columns: r.columns });
}

/**
 * Smart import: audit rows written inside withAuditBatch carry the file's batch id, and are
 * written as "system" when `system` is set (Excel bulk import by the user who uploaded the file).
 */
type AuditContext = { batchId: string; system: boolean };
const auditContext = new AsyncLocalStorage<AuditContext>();

export function withAuditBatch<T>(ctx: AuditContext, fn: () => Promise<T>): Promise<T> {
  return auditContext.run(ctx, fn);
}

/**
 * One audit_log row as the signed-in user, in the caller's transaction. It is sent with the
 * commit (withCommit), so it costs no round trip of its own; if it fails, nothing is saved.
 */
export function audit(
  tx: Tx,
  companyId: string,
  table: TableName,
  recordId: string,
  action: AuditEntry["action"],
  before: object | null,
  after: object,
): void {
  const changes = auditChanges(before, after);
  const ctx = auditContext.getStore();
  const system = ctx?.system === true;
  withCommit(
    tx,
    tx`insert into audit_log (company_id, actor, user_id, batch_id, table_name, record_id, action, changes)
       values (${companyId}, ${system ? "system" : "user"}, ${system ? tx`null` : tx`auth.uid()`},
               ${ctx?.batchId ?? null}, ${table}, ${recordId}, ${action},
               ${tx.json(changes as never)})`,
  );
}

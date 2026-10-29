// Table rows (snake_case) → the lib/types records screens already use, and the audit writer.
// The reverse direction for the seed lives in db/rows.ts.
import type {
  AuditEntry,
  Company,
  Driver,
  Item,
  Membership,
  Party,
  Truck,
  User,
} from "@/lib/types";
import { auditChanges, type TableName } from "../_store";
import { withCommit, type Tx } from "./conn";
import { urlFromPath } from "./storage";

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
  withCommit(
    tx,
    tx`insert into audit_log (company_id, actor, user_id, table_name, record_id, action, changes)
       values (${companyId}, 'user', auth.uid(), ${table}, ${recordId}, ${action},
               ${tx.json(changes as never)})`,
  );
}

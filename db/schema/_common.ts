// Shared column sets and enums. Enums mirror lib/types.ts 1:1 (docs/DATABASE.md §2).
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const memberRole = pgEnum("member_role", ["owner", "accountant", "booking_staff", "driver"]);
export const lrPaymentMode = pgEnum("lr_payment_mode", ["to_pay", "paid", "tbb"]);
export const gstPayer = pgEnum("gst_payer", ["consignor", "consignee", "transporter"]);
export const chargedAs = pgEnum("charged_as", ["ftl", "per_kg", "per_pkg"]);
export const risk = pgEnum("risk", ["owner", "carrier"]);
export const podCondition = pgEnum("pod_condition", ["good", "short", "damaged"]);
export const freightGstMode = pgEnum("freight_gst_mode", ["reverse_charge", "forward_charge"]);
export const receiptMode = pgEnum("receipt_mode", ["neft_upi", "cheque", "cash"]);
export const recordSource = pgEnum("record_source", ["manual", "lr", "invoice_scan", "excel_import"]);
export const docStatus = pgEnum("doc_status", ["draft", "final"]);
export const numberSeriesKind = pgEnum("number_series_kind", ["lr", "freight_bill", "tax_invoice"]);
export const auditAction = pgEnum("audit_action", ["create", "update", "cancel"]);
export const auditActor = pgEnum("audit_actor", ["user", "system"]);
export const importSource = pgEnum("import_source", ["excel", "document"]);
export const importFormat = pgEnum("import_format", ["xlsx", "xls", "csv", "pdf", "jpg", "png"]);
export const importKind = pgEnum("import_kind", ["excel", "csv", "pdf", "image"]);
export const importDetectedAs = pgEnum("import_detected_as", [
  "booking_report",
  "tax_invoice",
  "lr",
  "pod",
  "eway_bill",
  "unknown",
]);
export const importStatus = pgEnum("import_status", [
  "uploaded",
  "read",
  "reviewed",
  "imported",
  "failed",
]);

/** Same shape as lib/validators/common.ts (the checksum stays an app-level check). */
export const GSTIN_SHAPE_SQL = "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$";

/** Integer paise. */
export const paise = (name: string) => bigint(name, { mode: "number" });
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

/** created/updated/cancelled/version columns every business table carries (§1). */
export function businessColumns(users: () => AnyPgColumn) {
  return {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(users),
    updatedBy: uuid("updated_by").references(users),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    version: integer("version").notNull().default(1),
  };
}

type Biz = {
  id: AnyPgColumn;
  companyId: AnyPgColumn;
  cancelledAt: AnyPgColumn;
  cancelReason: AnyPgColumn;
};

/** unique (company_id, id) for composite FKs + the cancel_reason check. */
export function businessConstraints(name: string, t: Biz) {
  return [
    unique(`${name}_company_id_id_key`).on(t.companyId, t.id),
    check(`${name}_cancel_reason_check`, sql`cancel_reason is null or cancelled_at is not null`),
  ];
}

/** Composite FK (company_id, col) → parent (company_id, id), plus an index for it. */
export function companyFk(
  name: string,
  companyId: AnyPgColumn,
  col: AnyPgColumn,
  parent: { companyId: AnyPgColumn; id: AnyPgColumn },
  /** false when a wider index starting with (company_id, col) already exists. */
  withIndex = true,
) {
  const fk = foreignKey({
    name: `${name}_fk`,
    columns: [companyId, col],
    foreignColumns: [parent.companyId, parent.id],
  });
  return withIndex ? [fk, index(`${name}_idx`).on(companyId, col)] : [fk];
}

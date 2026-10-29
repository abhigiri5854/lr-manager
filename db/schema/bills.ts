// POD, freight bills and payments (docs/DATABASE.md §3.6–3.7).
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { FreightBill } from "@/lib/types";
import {
  businessColumns,
  businessConstraints,
  companyFk,
  docStatus,
  freightGstMode,
  paise,
  podCondition,
  receiptMode,
  ts,
} from "./_common";
import { companies, users } from "./companies";
import { lrs } from "./lrs";
import { parties } from "./masters";

const byUser = () => users.id;
const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

export const pods = pgTable(
  "pods",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    lrId: uuid("lr_id").notNull(),
    receivedBy: text("received_by"),
    receiverPhone: text("receiver_phone"),
    packagesReceived: integer("packages_received"),
    condition: podCondition("condition").notNull().default("good"),
    remarks: text("remarks"),
    documentPaths: text("document_paths")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    receivedAt: ts("received_at"),
  },
  (t) => [
    ...businessConstraints("pods", t),
    ...companyFk("pods_lr", t.companyId, t.lrId, lrs),
    uniqueIndex("pods_live_lr_key")
      .on(t.companyId, t.lrId)
      .where(sql`cancelled_at is null`),
    index("pods_company_received_idx").on(t.companyId, t.receivedAt.desc()),
    check("pods_packages_check", sql`packages_received is null or packages_received >= 0`),
  ],
).enableRLS();

export const freightBills = pgTable(
  "freight_bills",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    status: docStatus("status").notNull().default("draft"),
    billNo: text("bill_no"),
    billFy: text("bill_fy"),
    billSeq: bigint("bill_seq", { mode: "number" }),
    billDate: date("bill_date", { mode: "string" }).notNull(),
    partyId: uuid("party_id").notNull(),
    gstMode: freightGstMode("gst_mode").notNull(),
    gstRateBp: integer("gst_rate_bp").notNull().default(0),
    snapshot: jsonb("snapshot").$type<NonNullable<FreightBill["snapshot"]>>(),
    chargesPaise: paise("charges_paise").notNull().default(0),
    sgstPaise: paise("sgst_paise").notNull().default(0),
    cgstPaise: paise("cgst_paise").notNull().default(0),
    igstPaise: paise("igst_paise").notNull().default(0),
    advancePaise: paise("advance_paise").notNull().default(0),
    amountPaise: paise("amount_paise").notNull().default(0),
    /** Kept by trigger: bill no., party name, LR nos. */
    searchText: text("search_text").notNull().default(""),
  },
  (t) => [
    ...businessConstraints("freight_bills", t),
    ...companyFk("freight_bills_party", t.companyId, t.partyId, parties),
    uniqueIndex("freight_bills_seq_key")
      .on(t.companyId, t.billFy, t.billSeq)
      .where(sql`bill_seq is not null`),
    check(
      "freight_bills_final_check",
      sql`status = 'draft' or (bill_no is not null and snapshot is not null)`,
    ),
    check(
      "freight_bills_amounts_check",
      sql`charges_paise >= 0 and sgst_paise >= 0 and cgst_paise >= 0 and igst_paise >= 0 and advance_paise >= 0`,
    ),
    check("freight_bills_gst_rate_check", sql`gst_rate_bp between 0 and 2800`),
    check("freight_bills_fy_check", sql`bill_fy is null or bill_fy ~ '^[0-9]{4}-[0-9]{2}$'`),
    index("freight_bills_company_date_idx").on(t.companyId, t.billDate.desc()),
    index("freight_bills_company_status_idx").on(t.companyId, t.status),
  ],
).enableRLS();

export const freightBillLines = pgTable(
  "freight_bill_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyId(),
    freightBillId: uuid("freight_bill_id").notNull(),
    lrId: uuid("lr_id").notNull(),
    position: smallint("position").notNull(),
    freightPaise: paise("freight_paise").notNull(),
    detentionPaise: paise("detention_paise").notNull().default(0),
    otherPaise: paise("other_paise").notNull().default(0),
    advancePaise: paise("advance_paise").notNull().default(0),
    totalPaise: paise("total_paise").notNull(),
    /** Copied from the bill by trigger, so the live-line unique index can see it. */
    billCancelledAt: ts("bill_cancelled_at"),
  },
  (t) => [
    unique("freight_bill_lines_position_key").on(t.freightBillId, t.position),
    ...companyFk("freight_bill_lines_bill", t.companyId, t.freightBillId, freightBills),
    ...companyFk("freight_bill_lines_lr", t.companyId, t.lrId, lrs),
    uniqueIndex("freight_bill_lines_live_lr_key")
      .on(t.companyId, t.lrId)
      .where(sql`bill_cancelled_at is null`),
    check(
      "freight_bill_lines_amounts_check",
      sql`freight_paise >= 0 and detention_paise >= 0 and other_paise >= 0 and advance_paise >= 0 and total_paise >= 0`,
    ),
  ],
).enableRLS();

export const payments = pgTable(
  "payments",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    partyId: uuid("party_id").notNull(),
    amountPaise: paise("amount_paise").notNull(),
    tdsPaise: paise("tds_paise").notNull().default(0),
    mode: receiptMode("mode").notNull(),
    receivedOn: date("received_on", { mode: "string" }).notNull(),
    reference: text("reference"),
  },
  (t) => [
    ...businessConstraints("payments", t),
    ...companyFk("payments_party", t.companyId, t.partyId, parties, false),
    index("payments_company_party_received_idx").on(t.companyId, t.partyId, t.receivedOn.desc()),
    check("payments_amount_check", sql`amount_paise > 0`),
    check("payments_tds_check", sql`tds_paise >= 0`),
  ],
).enableRLS();

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyId(),
    paymentId: uuid("payment_id").notNull(),
    freightBillId: uuid("freight_bill_id").notNull(),
    amountPaise: paise("amount_paise").notNull(),
  },
  (t) => [
    unique("payment_allocations_bill_key").on(t.paymentId, t.freightBillId),
    ...companyFk("payment_allocations_payment", t.companyId, t.paymentId, payments),
    ...companyFk("payment_allocations_bill", t.companyId, t.freightBillId, freightBills),
    check("payment_allocations_amount_check", sql`amount_paise > 0`),
  ],
).enableRLS();

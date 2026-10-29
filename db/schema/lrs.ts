// LR, its goods lines and its goods invoices (docs/DATABASE.md §3.4).
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { LrSnapshot } from "@/lib/types";
import {
  businessColumns,
  businessConstraints,
  chargedAs,
  companyFk,
  gstPayer,
  lrPaymentMode,
  paise,
  risk,
  ts,
} from "./_common";
import { companies, users } from "./companies";
import { importBatches } from "./imports";
import { taxInvoices } from "./invoices";
import { items, parties, trucks } from "./masters";

const byUser = () => users.id;

export const lrs = pgTable(
  "lrs",
  {
    ...businessColumns(byUser),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    importBatchId: uuid("import_batch_id"),
    lrNo: text("lr_no").notNull(),
    lrFy: text("lr_fy"),
    lrSeq: bigint("lr_seq", { mode: "number" }),
    lrDate: date("lr_date", { mode: "string" }),
    fromPlace: text("from_place"),
    toPlace: text("to_place"),
    risk: risk("risk").notNull().default("owner"),
    consignorId: uuid("consignor_id"),
    consigneeId: uuid("consignee_id"),
    billedToId: uuid("billed_to_id"),
    gstPaidBy: gstPayer("gst_paid_by"),
    paymentMode: lrPaymentMode("payment_mode"),
    chargedAs: chargedAs("charged_as"),
    ratePaise: paise("rate_paise"),
    truckId: uuid("truck_id"),
    driverMobile: text("driver_mobile"),
    remarks: text("remarks"),
    // charges (fixed set; balance and grand total are computed in lib/lr-charges.ts)
    freightPaise: paise("freight_paise"),
    packingPaise: paise("packing_paise"),
    cnChargePaise: paise("cn_charge_paise"),
    loadingPaise: paise("loading_paise"),
    unloadingPaise: paise("unloading_paise"),
    detentionPaise: paise("detention_paise"),
    otherPaise: paise("other_paise"),
    gstPaise: paise("gst_paise"),
    advancePaise: paise("advance_paise"),
    // lifecycle stamps the LR owns
    bookedAt: ts("booked_at"),
    dispatchedAt: ts("dispatched_at"),
    deliveredAt: ts("delivered_at"),
    // cached from the POD / bill / payments by trigger (app.refresh_lr_stamps)
    podReceivedAt: ts("pod_received_at"),
    billedAt: date("billed_at", { mode: "string" }),
    paidAt: date("paid_at", { mode: "string" }),
    snapshot: jsonb("snapshot").$type<LrSnapshot>(),
    /** Kept by trigger: LR no., party names, truck, places, invoice / e-way nos. */
    searchText: text("search_text").notNull().default(""),
  },
  (t) => [
    ...businessConstraints("lrs", t),
    unique("lrs_company_lr_no_key").on(t.companyId, t.lrNo),
    check(
      "lrs_booked_check",
      sql`booked_at is null or (lr_date is not null and snapshot is not null)`,
    ),
    check(
      "lrs_charges_check",
      sql`coalesce(freight_paise, 0) >= 0 and coalesce(packing_paise, 0) >= 0 and coalesce(cn_charge_paise, 0) >= 0 and coalesce(loading_paise, 0) >= 0 and coalesce(unloading_paise, 0) >= 0 and coalesce(detention_paise, 0) >= 0 and coalesce(other_paise, 0) >= 0 and coalesce(gst_paise, 0) >= 0 and coalesce(advance_paise, 0) >= 0 and coalesce(rate_paise, 0) >= 0`,
    ),
    check("lrs_fy_check", sql`lr_fy is null or lr_fy ~ '^[0-9]{4}-[0-9]{2}$'`),
    ...companyFk("lrs_batch", t.companyId, t.importBatchId, importBatches),
    ...companyFk("lrs_consignor", t.companyId, t.consignorId, parties),
    ...companyFk("lrs_consignee", t.companyId, t.consigneeId, parties),
    ...companyFk("lrs_billed_to", t.companyId, t.billedToId, parties),
    ...companyFk("lrs_truck", t.companyId, t.truckId, trucks, false),
    index("lrs_company_truck_created_idx").on(t.companyId, t.truckId, t.createdAt),
    index("lrs_company_created_idx").on(t.companyId, t.createdAt.desc()),
    index("lrs_company_lr_date_idx").on(t.companyId, t.lrDate),
    index("lrs_open_idx")
      .on(t.companyId, t.createdAt.desc())
      .where(sql`cancelled_at is null and delivered_at is null`),
    index("lrs_pod_pending_idx")
      .on(t.companyId, t.deliveredAt)
      .where(sql`delivered_at is not null and pod_received_at is null and cancelled_at is null`),
    index("lrs_unbilled_tbb_idx")
      .on(t.companyId)
      .where(sql`payment_mode = 'tbb' and booked_at is not null and cancelled_at is null`),
    index("lrs_repeat_routes_idx")
      .on(t.companyId, t.consignorId, t.consigneeId, t.lrDate.desc())
      .where(sql`booked_at is not null and cancelled_at is null`),
    index("lrs_company_driver_mobile_idx").on(t.companyId, t.driverMobile),
  ],
).enableRLS();

export const lrItems = pgTable(
  "lr_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    lrId: uuid("lr_id").notNull(),
    position: smallint("position").notNull(),
    itemId: uuid("item_id"),
    description: text("description").notNull(),
    packages: integer("packages").notNull().default(0),
    actualWeight: numeric("actual_weight", { precision: 12, scale: 3 }),
    chargedWeight: numeric("charged_weight", { precision: 12, scale: 3 }),
    size: text("size"),
  },
  (t) => [
    unique("lr_items_position_key").on(t.lrId, t.position),
    ...companyFk("lr_items_lr", t.companyId, t.lrId, lrs),
    ...companyFk("lr_items_item", t.companyId, t.itemId, items),
    check("lr_items_packages_check", sql`packages >= 0`),
    check(
      "lr_items_weight_check",
      sql`coalesce(actual_weight, 0) >= 0 and coalesce(charged_weight, 0) >= 0`,
    ),
  ],
).enableRLS();

export const lrInvoices = pgTable(
  "lr_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    lrId: uuid("lr_id").notNull(),
    position: smallint("position").notNull(),
    invoiceNo: text("invoice_no").notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }),
    valuePaise: paise("value_paise"),
    ewayBillNo: text("eway_bill_no"),
    ewayExpiresAt: ts("eway_expires_at"),
    taxInvoiceId: uuid("tax_invoice_id"),
  },
  (t) => [
    unique("lr_invoices_position_key").on(t.lrId, t.position),
    ...companyFk("lr_invoices_lr", t.companyId, t.lrId, lrs),
    ...companyFk("lr_invoices_tax_invoice", t.companyId, t.taxInvoiceId, taxInvoices),
    check("lr_invoices_eway_check", sql`eway_bill_no is null or eway_bill_no ~ '^[0-9]{12}$'`),
    check("lr_invoices_value_check", sql`value_paise is null or value_paise >= 0`),
    index("lr_invoices_eway_expiry_idx")
      .on(t.companyId, t.ewayExpiresAt)
      .where(sql`eway_bill_no is not null`),
  ],
).enableRLS();

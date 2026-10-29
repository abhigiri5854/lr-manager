// Tax (goods) invoices (docs/DATABASE.md §3.5).
import { sql } from "drizzle-orm";
import {
  bigint,
  char,
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { TaxInvoice } from "@/lib/types";
import { businessColumns, businessConstraints, companyFk, docStatus, paise, ts } from "./_common";
import { companies, users } from "./companies";
import { importBatches } from "./imports";
import { items, parties, trucks } from "./masters";

const byUser = () => users.id;

export const taxInvoices = pgTable(
  "tax_invoices",
  {
    ...businessColumns(byUser),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    invoiceNo: text("invoice_no"),
    invoiceFy: text("invoice_fy"),
    invoiceSeq: bigint("invoice_seq", { mode: "number" }),
    invoiceAt: ts("invoice_at").notNull(),
    status: docStatus("status").notNull().default("draft"),
    sellerPartyId: uuid("seller_party_id"),
    billToId: uuid("bill_to_id").notNull(),
    shipToId: uuid("ship_to_id"),
    placeOfSupplyStateCode: char("place_of_supply_state_code", { length: 2 }).notNull(),
    customerRef: text("customer_ref"),
    customerRefDate: date("customer_ref_date", { mode: "string" }),
    soNo: text("so_no"),
    soDate: date("so_date", { mode: "string" }),
    doNo: text("do_no"),
    sapRef: text("sap_ref"),
    transporterName: text("transporter_name"),
    truckId: uuid("truck_id"),
    driverMobile: text("driver_mobile"),
    shipFrom: text("ship_from"),
    incoterm: text("incoterm"),
    irn: text("irn"),
    ewayBillNo: text("eway_bill_no"),
    sourceFilePath: text("source_file_path"),
    importBatchId: uuid("import_batch_id"),
    snapshot: jsonb("snapshot").$type<NonNullable<TaxInvoice["snapshot"]>>(),
    taxablePaise: paise("taxable_paise").notNull().default(0),
    sgstPaise: paise("sgst_paise").notNull().default(0),
    cgstPaise: paise("cgst_paise").notNull().default(0),
    igstPaise: paise("igst_paise").notNull().default(0),
    roundOffPaise: paise("round_off_paise").notNull().default(0),
    totalPaise: paise("total_paise").notNull().default(0),
    /** Kept by trigger: no., bill-to name + GSTIN, linked LR nos. */
    searchText: text("search_text").notNull().default(""),
  },
  (t) => [
    ...businessConstraints("tax_invoices", t),
    check(
      "tax_invoices_final_check",
      sql`status = 'draft' or (invoice_no is not null and snapshot is not null)`,
    ),
    check(
      "tax_invoices_amounts_check",
      sql`taxable_paise >= 0 and sgst_paise >= 0 and cgst_paise >= 0 and igst_paise >= 0 and total_paise >= 0`,
    ),
    check("tax_invoices_fy_check", sql`invoice_fy is null or invoice_fy ~ '^[0-9]{4}-[0-9]{2}$'`),
    uniqueIndex("tax_invoices_own_seq_key")
      .on(t.companyId, t.invoiceFy, t.invoiceSeq)
      .where(sql`seller_party_id is null and invoice_seq is not null`),
    uniqueIndex("tax_invoices_seller_no_key")
      .on(
        t.companyId,
        sql`coalesce(seller_party_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
        t.invoiceFy,
        t.invoiceNo,
      )
      .where(sql`invoice_no is not null`),
    ...companyFk("tax_invoices_seller", t.companyId, t.sellerPartyId, parties),
    ...companyFk("tax_invoices_bill_to", t.companyId, t.billToId, parties),
    ...companyFk("tax_invoices_ship_to", t.companyId, t.shipToId, parties),
    ...companyFk("tax_invoices_truck", t.companyId, t.truckId, trucks),
    ...companyFk("tax_invoices_batch", t.companyId, t.importBatchId, importBatches),
    index("tax_invoices_company_at_idx").on(t.companyId, t.invoiceAt.desc()),
    index("tax_invoices_company_status_idx").on(t.companyId, t.status),
  ],
).enableRLS();

export const taxInvoiceLines = pgTable(
  "tax_invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    taxInvoiceId: uuid("tax_invoice_id").notNull(),
    lineNo: smallint("line_no").notNull(),
    itemId: uuid("item_id"),
    itemCode: text("item_code"),
    description: text("description").notNull(),
    hsn: text("hsn"),
    uom: text("uom"),
    qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
    ratePaise: paise("rate_paise").notNull(),
    discountPaise: paise("discount_paise").notNull().default(0),
    taxablePaise: paise("taxable_paise").notNull(),
    gstRateBp: integer("gst_rate_bp").notNull(),
    sgstPaise: paise("sgst_paise").notNull().default(0),
    cgstPaise: paise("cgst_paise").notNull().default(0),
    igstPaise: paise("igst_paise").notNull().default(0),
  },
  (t) => [
    unique("tax_invoice_lines_line_key").on(t.taxInvoiceId, t.lineNo),
    ...companyFk("tax_invoice_lines_invoice", t.companyId, t.taxInvoiceId, taxInvoices),
    ...companyFk("tax_invoice_lines_item", t.companyId, t.itemId, items),
    check(
      "tax_invoice_lines_amounts_check",
      sql`qty >= 0 and rate_paise >= 0 and discount_paise >= 0 and taxable_paise >= 0 and sgst_paise >= 0 and cgst_paise >= 0 and igst_paise >= 0`,
    ),
    check("tax_invoice_lines_gst_rate_check", sql`gst_rate_bp between 0 and 4000`),
  ],
).enableRLS();

// Tenants, people, permissions and number series (docs/DATABASE.md §3.1, §3.3).
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import {
  businessColumns,
  businessConstraints,
  GSTIN_SHAPE_SQL,
  memberRole,
  numberSeriesKind,
  paise,
  ts,
} from "./_common";

/** One row per Supabase Auth user (created by trigger on auth.users). No password here. */
export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    mobile: text("mobile"),
    email: text("email"),
    lastLoginAt: ts("last_login_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    cancelledAt: ts("cancelled_at"),
    /** The one company this login belongs to; set by trigger when the membership is made. */
    companyId: uuid("company_id").references((): AnyPgColumn => companies.id),
  },
  (t) => [
    uniqueIndex("users_company_mobile_key")
      .on(t.companyId, t.mobile)
      .where(sql`mobile is not null`),
    uniqueIndex("users_company_email_key")
      .on(t.companyId, sql`lower(${t.email})`)
      .where(sql`email is not null`),
    check("users_mobile_check", sql`mobile is null or mobile ~ '^[0-9]{10}$'`),
  ],
).enableRLS();

const byUser = () => users.id;

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(byUser),
    updatedBy: uuid("updated_by").references(byUser),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    version: integer("version").notNull().default(1),
    /** Short login code (letters / digits); unique among active companies. */
    code: text("code").notNull(),
    label: text("label").notNull(),
    name: text("name").notNull(),
    city: text("city").notNull().default(""),
    office: text("office").notNull().default(""),
    email: text("email"),
    website: text("website"),
    mobile1: text("mobile1"),
    mobile2: text("mobile2"),
    gstin: text("gstin").notNull(),
    pan: text("pan").notNull(),
    udyam: text("udyam"),
    bankAccountName: text("bank_account_name"),
    bankName: text("bank_name"),
    bankAccountNo: text("bank_account_no"),
    bankIfsc: text("bank_ifsc"),
    invoiceTitle: text("invoice_title").notNull().default("FREIGHT INVOICE"),
    invoiceNote: text("invoice_note"),
    freightBillPrefix: text("freight_bill_prefix").notNull().default(""),
    taxInvoicePrefix: text("tax_invoice_prefix").notNull().default(""),
    invoiceRoundOff: boolean("invoice_round_off").notNull().default(true),
    numberingResetsYearly: boolean("numbering_resets_yearly").notNull().default(true),
    freightGstRateBp: integer("freight_gst_rate_bp").notNull().default(500),
    signatoryName: text("signatory_name"),
    lrPrefix: text("lr_prefix").notNull().default(""),
    jurisdiction: text("jurisdiction"),
    podDays: integer("pod_days"),
    podPenaltyPerDayPaise: paise("pod_penalty_per_day_paise"),
    lrCopies: text("lr_copies")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    detention: text("detention"),
    lrTerms: text("lr_terms"),
    logoPath: text("logo_path"),
    useLogoWatermark: boolean("use_logo_watermark").notNull().default(false),
    signaturePath: text("signature_path"),
  },
  (t) => [
    check("companies_code_check", sql`code ~ '^[A-Z0-9]{3,10}$'`),
    uniqueIndex("companies_code_key")
      .on(t.code)
      .where(sql`cancelled_at is null`),
    check("companies_gstin_check", sql`gstin ~ ${sql.raw(`'${GSTIN_SHAPE_SQL}'`)}`),
    check("companies_pan_check", sql`pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'`),
    check(
      "companies_bank_check",
      sql`num_nonnulls(bank_account_name, bank_name, bank_account_no, bank_ifsc) in (0, 4)`,
    ),
    check("companies_gst_rate_check", sql`freight_gst_rate_bp between 0 and 2800`),
    check("companies_pod_days_check", sql`pod_days is null or pod_days >= 0`),
    check(
      "companies_pod_penalty_check",
      sql`pod_penalty_per_day_paise is null or pod_penalty_per_day_paise >= 0`,
    ),
    check("companies_cancel_reason_check", sql`cancel_reason is null or cancelled_at is not null`),
  ],
).enableRLS();

export const memberships = pgTable(
  "memberships",
  {
    ...businessColumns(byUser),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    userId: uuid("user_id").notNull().references(byUser),
    role: memberRole("role").notNull(),
  },
  (t) => [
    ...businessConstraints("memberships", t),
    uniqueIndex("memberships_company_user_key")
      .on(t.companyId, t.userId)
      .where(sql`cancelled_at is null`),
    uniqueIndex("memberships_user_company_key")
      .on(t.userId, t.companyId)
      .where(sql`cancelled_at is null`),
    // One login = one company.
    uniqueIndex("memberships_one_company_per_user")
      .on(t.userId)
      .where(sql`cancelled_at is null`),
  ],
).enableRLS();

/** Lookup seeded from PERMISSIONS in lib/permissions.ts (a test keeps them identical). */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    role: memberRole("role").notNull(),
    action: text("action").notNull(),
  },
  (t) => [primaryKey({ name: "role_permissions_pkey", columns: [t.role, t.action] })],
).enableRLS();

export const numberSeries = pgTable(
  "number_series",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    series: numberSeriesKind("series").notNull(),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull().default(""),
    nextNo: bigint("next_no", { mode: "number" }).notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "number_series_pkey", columns: [t.companyId, t.series, t.fy] }),
    check("number_series_fy_check", sql`fy ~ '^[0-9]{4}-[0-9]{2}$'`),
    check("number_series_next_no_check", sql`next_no >= 1`),
    index("number_series_company_idx").on(t.companyId),
  ],
).enableRLS();

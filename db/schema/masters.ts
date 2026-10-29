// Parties, drivers, trucks, items (docs/DATABASE.md §3.2). Search columns + trigram indexes: §7.
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  businessColumns,
  businessConstraints,
  chargedAs,
  companyFk,
  gstPayer,
  GSTIN_SHAPE_SQL,
  lrPaymentMode,
  paise,
  recordSource,
  ts,
} from "./_common";
import { companies, users } from "./companies";

const byUser = () => users.id;
const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

/** lower(a || ' ' || b …) — immutable, so it can be a stored generated column. */
const searchOf = (...cols: string[]) =>
  sql.raw(`lower(${cols.map((c) => `coalesce(${c}, '')`).join(" || ' ' || ")})`);

export const parties = pgTable(
  "parties",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    name: text("name").notNull(),
    place: text("place"),
    gstin: text("gstin"),
    pan: text("pan"),
    phone: text("phone"),
    address: text("address"),
    stateCode: char("state_code", { length: 2 }),
    pincode: text("pincode"),
    logoPath: text("logo_path"),
    defaultFrom: text("default_from"),
    defaultPaymentMode: lrPaymentMode("default_payment_mode"),
    defaultGstPayer: gstPayer("default_gst_payer"),
    defaultChargedAs: chargedAs("default_charged_as"),
    source: recordSource("source").notNull().default("manual"),
    isSelf: boolean("is_self").notNull().default(false),
    searchText: text("search_text").generatedAlwaysAs(searchOf("name", "place", "gstin", "phone")),
  },
  (t) => [
    ...businessConstraints("parties", t),
    check("parties_gstin_check", sql`gstin is null or gstin ~ ${sql.raw(`'${GSTIN_SHAPE_SQL}'`)}`),
    uniqueIndex("parties_company_gstin_key")
      .on(t.companyId, t.gstin)
      .where(sql`gstin is not null and cancelled_at is null`),
    uniqueIndex("parties_company_self_key")
      .on(t.companyId)
      .where(sql`is_self`),
    index("parties_company_name_idx").on(t.companyId, sql`lower(${t.name})`),
  ],
).enableRLS();

export const drivers = pgTable(
  "drivers",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    mobile: text("mobile").notNull(),
    name: text("name"),
    licenceNo: text("licence_no"),
    licenceExpiry: date("licence_expiry", { mode: "string" }),
    userId: uuid("user_id").references(byUser),
    invitedAt: ts("invited_at"),
    searchText: text("search_text").generatedAlwaysAs(searchOf("name", "licence_no", "mobile")),
  },
  (t) => [
    ...businessConstraints("drivers", t),
    check("drivers_mobile_check", sql`mobile ~ '^[0-9]{10}$'`),
    uniqueIndex("drivers_company_mobile_key")
      .on(t.companyId, t.mobile)
      .where(sql`cancelled_at is null`),
    index("drivers_user_idx").on(t.userId),
    index("drivers_licence_expiry_idx")
      .on(t.companyId, t.licenceExpiry)
      .where(sql`cancelled_at is null`),
  ],
).enableRLS();

export const trucks = pgTable(
  "trucks",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    number: text("number").notNull(),
    driverId: uuid("driver_id"),
    rcExpiry: date("rc_expiry", { mode: "string" }),
    insuranceExpiry: date("insurance_expiry", { mode: "string" }),
    permitExpiry: date("permit_expiry", { mode: "string" }),
    fitnessExpiry: date("fitness_expiry", { mode: "string" }),
    source: recordSource("source").notNull().default("manual"),
  },
  (t) => [
    ...businessConstraints("trucks", t),
    check("trucks_number_check", sql`number ~ '^[A-Z0-9]+$'`),
    uniqueIndex("trucks_company_number_key")
      .on(t.companyId, t.number)
      .where(sql`cancelled_at is null`),
    ...companyFk("trucks_driver", t.companyId, t.driverId, drivers),
    index("trucks_rc_expiry_idx")
      .on(t.companyId, t.rcExpiry)
      .where(sql`cancelled_at is null`),
    index("trucks_insurance_expiry_idx")
      .on(t.companyId, t.insuranceExpiry)
      .where(sql`cancelled_at is null`),
    index("trucks_permit_expiry_idx")
      .on(t.companyId, t.permitExpiry)
      .where(sql`cancelled_at is null`),
    index("trucks_fitness_expiry_idx")
      .on(t.companyId, t.fitnessExpiry)
      .where(sql`cancelled_at is null`),
  ],
).enableRLS();

export const items = pgTable(
  "items",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    code: text("code"),
    name: text("name").notNull(),
    hsn: text("hsn"),
    uom: text("uom"),
    gstRateBp: integer("gst_rate_bp"),
    lastRatePaise: paise("last_rate_paise"),
    searchText: text("search_text").generatedAlwaysAs(searchOf("code", "name", "hsn")),
  },
  (t) => [
    ...businessConstraints("items", t),
    check("items_gst_rate_check", sql`gst_rate_bp is null or gst_rate_bp between 0 and 4000`),
    check("items_last_rate_check", sql`last_rate_paise is null or last_rate_paise >= 0`),
    uniqueIndex("items_company_code_key")
      .on(t.companyId, sql`lower(${t.code})`)
      .where(sql`code is not null and cancelled_at is null`),
    index("items_company_code_prefix_idx").on(t.companyId, sql`lower(${t.code}) text_pattern_ops`),
  ],
).enableRLS();

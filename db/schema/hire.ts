// Tier 1: market-truck hire — challans, advances, POD settlement, truck payments
// (TIER1-MARKET-TRUCKS.md §5). Money is numeric(14,2) rupees; RLS, triggers and views are hand-written
// in db/migrations/0014_hire_rls_views.sql.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  allocationKind,
  businessColumns,
  businessConstraints,
  challanStatus,
  chargeDirection,
  chargeStage,
  companyFk,
  GSTIN_SHAPE_SQL,
  hireSeriesKind,
  money,
  payeeKind,
  podAutoKind,
  rateBasis,
  truckPartyRole,
  truckPartyStatus,
  truckPaymentMode,
  truckPaymentStatus,
  ts,
} from "./_common";
import { freightBills } from "./bills";
import { companies, users } from "./companies";
import { lrs } from "./lrs";

const byUser = () => users.id;
const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

const FY_SQL = "^[0-9]{4}-[0-9]{2}$";

export const branches = pgTable(
  "branches",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code"),
    address: text("address"),
  },
  (t) => [
    ...businessConstraints("branches", t),
    uniqueIndex("branches_company_name_key")
      .on(t.companyId, sql`lower(${t.name})`)
      .where(sql`cancelled_at is null`),
  ],
).enableRLS();

export const vehicleTypes = pgTable(
  "vehicle_types",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    name: text("name").notNull(),
    capacityKg: integer("capacity_kg"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    ...businessConstraints("vehicle_types", t),
    uniqueIndex("vehicle_types_company_name_key")
      .on(t.companyId, sql`lower(${t.name})`)
      .where(sql`cancelled_at is null`),
  ],
).enableRLS();

export const chargeTypes = pgTable(
  "charge_types",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    defaultDirection: chargeDirection("default_direction").notNull(),
    defaultBillParty: boolean("default_bill_party").notNull().default(false),
    stage: chargeStage("stage").notNull(),
    active: boolean("active").notNull().default(false),
  },
  (t) => [
    ...businessConstraints("charge_types", t),
    uniqueIndex("charge_types_company_code_key")
      .on(t.companyId, sql`lower(${t.code})`)
      .where(sql`cancelled_at is null`),
  ],
).enableRLS();

export const pumps = pgTable(
  "pumps",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    name: text("name").notNull(),
    location: text("location"),
    /** Ledger account the diesel advances debit (name comes from company settings / ledger module). */
    ledgerRef: text("ledger_ref"),
  },
  (t) => [
    ...businessConstraints("pumps", t),
    uniqueIndex("pumps_company_name_key")
      .on(t.companyId, sql`lower(${t.name})`)
      .where(sql`cancelled_at is null`),
  ],
).enableRLS();

export const truckParties = pgTable(
  "truck_parties",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    role: truckPartyRole("role").notNull().default("owner"),
    name: text("name").notNull(),
    mobile: text("mobile"),
    altMobile: text("alt_mobile"),
    pan: text("pan"),
    /** 4th PAN character: P individual, H HUF, anything else other. Hint for the TDS helper only. */
    panType: text("pan_type").generatedAlwaysAs(
      sql`case when pan is null then null when substr(pan, 4, 1) = 'P' then 'individual' when substr(pan, 4, 1) = 'H' then 'huf' else 'other' end`,
    ),
    gstin: text("gstin"),
    address: text("address"),
    bankName: text("bank_name"),
    accountNo: text("account_no"),
    ifsc: text("ifsc"),
    accountHolder: text("account_holder"),
    upiId: text("upi_id"),
    upiQrFile: text("upi_qr_file"),
    /** Optional bank proof (cancelled cheque / passbook), truck-docs bucket. */
    bankProofFile: text("bank_proof_file"),
    /** Set by trigger when any bank / UPI detail changes (cooling-period alert). */
    bankChangedAt: ts("bank_changed_at"),
    verified: boolean("verified").notNull().default(false),
    verifiedBy: uuid("verified_by").references(byUser),
    verifiedAt: ts("verified_at"),
    status: truckPartyStatus("status").notNull().default("active"),
    blacklistReason: text("blacklist_reason"),
    rating: smallint("rating"),
    ratingNotes: text("rating_notes"),
    notes: text("notes"),
    searchText: text("search_text").generatedAlwaysAs(
      sql`lower(coalesce(name, '') || ' ' || coalesce(mobile, '') || ' ' || coalesce(pan, ''))`,
    ),
  },
  (t) => [
    ...businessConstraints("truck_parties", t),
    check("truck_parties_pan_check", sql`pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'`),
    check(
      "truck_parties_gstin_check",
      sql`gstin is null or gstin ~ ${sql.raw(`'${GSTIN_SHAPE_SQL}'`)}`,
    ),
    check("truck_parties_mobile_check", sql`mobile is null or mobile ~ '^[0-9]{10}$'`),
    check("truck_parties_rating_check", sql`rating is null or rating between 1 and 5`),
    check(
      "truck_parties_blacklist_check",
      sql`status <> 'blacklisted' or blacklist_reason is not null`,
    ),
    index("truck_parties_company_name_idx").on(t.companyId, sql`lower(${t.name})`),
    index("truck_parties_company_pan_idx")
      .on(t.companyId, t.pan)
      .where(sql`pan is not null`),
  ],
).enableRLS();

export const tdsDeclarations = pgTable(
  "tds_declarations",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    partyId: uuid("party_id").notNull(),
    fy: text("fy").notNull(),
    fileUrl: text("file_url"),
    vehiclesOwnedDeclared: integer("vehicles_owned_declared"),
    receivedOn: date("received_on", { mode: "string" }),
  },
  (t) => [
    ...businessConstraints("tds_declarations", t),
    ...companyFk("tds_declarations_party", t.companyId, t.partyId, truckParties, false),
    check("tds_declarations_fy_check", sql`fy ~ ${sql.raw(`'${FY_SQL}'`)}`),
    check(
      "tds_declarations_vehicles_check",
      sql`vehicles_owned_declared is null or vehicles_owned_declared >= 0`,
    ),
    uniqueIndex("tds_declarations_party_fy_key")
      .on(t.companyId, t.partyId, t.fy)
      .where(sql`cancelled_at is null`),
  ],
).enableRLS();

export const marketDrivers = pgTable(
  "market_drivers",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    name: text("name").notNull(),
    mobile: text("mobile"),
    dlNo: text("dl_no"),
    dlUpto: date("dl_upto", { mode: "string" }),
    dlFile: text("dl_file"),
  },
  (t) => [
    ...businessConstraints("market_drivers", t),
    check("market_drivers_mobile_check", sql`mobile is null or mobile ~ '^[0-9]{10}$'`),
    index("market_drivers_company_mobile_idx")
      .on(t.companyId, t.mobile)
      .where(sql`mobile is not null`),
    index("market_drivers_dl_upto_idx")
      .on(t.companyId, t.dlUpto)
      .where(sql`cancelled_at is null`),
  ],
).enableRLS();

export const marketVehicles = pgTable(
  "market_vehicles",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    /** Normalised: upper case, letters and digits only. */
    vehicleNo: text("vehicle_no").notNull(),
    ownerPartyId: uuid("owner_party_id"),
    vehicleTypeId: uuid("vehicle_type_id"),
    capacityKg: integer("capacity_kg"),
    rcOwnerName: text("rc_owner_name"),
    insuranceUpto: date("insurance_upto", { mode: "string" }),
    fitnessUpto: date("fitness_upto", { mode: "string" }),
    permitUpto: date("permit_upto", { mode: "string" }),
    pucUpto: date("puc_upto", { mode: "string" }),
    rcFile: text("rc_file"),
    extractedJson: jsonb("extracted_json"),
    lastVerifiedAt: ts("last_verified_at"),
  },
  (t) => [
    ...businessConstraints("market_vehicles", t),
    check("market_vehicles_no_check", sql`vehicle_no ~ '^[A-Z0-9]+$'`),
    uniqueIndex("market_vehicles_company_no_key")
      .on(t.companyId, t.vehicleNo)
      .where(sql`cancelled_at is null`),
    ...companyFk("market_vehicles_owner", t.companyId, t.ownerPartyId, truckParties),
    ...companyFk("market_vehicles_type", t.companyId, t.vehicleTypeId, vehicleTypes),
    index("market_vehicles_insurance_idx")
      .on(t.companyId, t.insuranceUpto)
      .where(sql`cancelled_at is null`),
    index("market_vehicles_fitness_idx")
      .on(t.companyId, t.fitnessUpto)
      .where(sql`cancelled_at is null`),
    index("market_vehicles_permit_idx")
      .on(t.companyId, t.permitUpto)
      .where(sql`cancelled_at is null`),
  ],
).enableRLS();

/** Per company + branch + FY counters for challans and truck payments (row-locked, never max + 1). */
export const hireNumberSeries = pgTable(
  "hire_number_series",
  {
    companyId: companyId(),
    docType: hireSeriesKind("doc_type").notNull(),
    branchId: uuid("branch_id").notNull(),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull().default(""),
    nextNo: bigint("next_no", { mode: "number" }).notNull().default(1),
    padding: smallint("padding").notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "hire_number_series_pkey",
      columns: [t.companyId, t.docType, t.branchId, t.fy],
    }),
    ...companyFk("hire_number_series_branch", t.companyId, t.branchId, branches, false),
    check("hire_number_series_fy_check", sql`fy ~ ${sql.raw(`'${FY_SQL}'`)}`),
    check("hire_number_series_next_no_check", sql`next_no >= 1`),
    check("hire_number_series_padding_check", sql`padding between 0 and 12`),
  ],
).enableRLS();

export const challans = pgTable(
  "challans",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    challanNo: text("challan_no").notNull(),
    challanFy: text("challan_fy").notNull(),
    challanSeq: bigint("challan_seq", { mode: "number" }),
    challanAt: ts("challan_at").notNull().defaultNow(),
    branchId: uuid("branch_id").notNull(),
    source: text("source"),
    destination: text("destination"),
    vehicleId: uuid("vehicle_id"),
    vehicleTypeId: uuid("vehicle_type_id"),
    driverId: uuid("driver_id"),
    brokerId: uuid("broker_id"),
    /** Who the lorry hire is paid to (follows payee_kind: owner or broker). */
    payeePartyId: uuid("payee_party_id"),
    payeeKind: payeeKind("payee_kind").notNull().default("owner"),
    rateBasis: rateBasis("rate_basis").notNull().default("trip"),
    rate: money("rate").notNull().default("0"),
    qtyTonnes: numeric("qty_tonnes", { precision: 12, scale: 3 }),
    hireAmount: money("hire_amount").notNull().default("0"),
    remarks: text("remarks"),
    status: challanStatus("status").notNull().default("draft"),
    dispatchedAt: ts("dispatched_at"),
    reportedAt: ts("reported_at"),
    unloadedAt: ts("unloaded_at"),
    podReceivedAt: ts("pod_received_at"),
    settledAt: ts("settled_at"),
    ewbAlertHours: integer("ewb_alert_hours"),
    /** Late-POD fee override for this challan (days + fee default from company settings). */
    latePodDays: integer("late_pod_days"),
    latePodFee: money("late_pod_fee"),
    /** Last reopen of a settled challan (record.cancel + reason; 0020_pod_settlement.sql). */
    reopenedAt: ts("reopened_at"),
    reopenReason: text("reopen_reason"),
  },
  (t) => [
    ...businessConstraints("challans", t),
    check("challans_reopen_check", sql`(reopened_at is null) = (reopen_reason is null)`),
    check(
      "challans_pod_status_check",
      sql`status not in ('pod_received', 'settled') or pod_received_at is not null`,
    ),
    check("challans_settled_check", sql`status <> 'settled' or settled_at is not null`),
    ...companyFk("challans_branch", t.companyId, t.branchId, branches),
    ...companyFk("challans_vehicle", t.companyId, t.vehicleId, marketVehicles),
    ...companyFk("challans_vehicle_type", t.companyId, t.vehicleTypeId, vehicleTypes),
    ...companyFk("challans_driver", t.companyId, t.driverId, marketDrivers),
    ...companyFk("challans_broker", t.companyId, t.brokerId, truckParties),
    ...companyFk("challans_payee", t.companyId, t.payeePartyId, truckParties),
    uniqueIndex("challans_no_key").on(t.companyId, t.branchId, t.challanFy, t.challanNo),
    uniqueIndex("challans_seq_key")
      .on(t.companyId, t.branchId, t.challanFy, t.challanSeq)
      .where(sql`challan_seq is not null`),
    check("challans_fy_check", sql`challan_fy ~ ${sql.raw(`'${FY_SQL}'`)}`),
    check("challans_amounts_check", sql`rate >= 0 and hire_amount >= 0`),
    check("challans_qty_check", sql`qty_tonnes is null or qty_tonnes >= 0`),
    check("challans_per_tonne_check", sql`rate_basis <> 'per_tonne' or qty_tonnes is not null`),
    index("challans_company_at_idx").on(t.companyId, t.challanAt.desc()),
    index("challans_company_status_idx").on(t.companyId, t.status),
    index("challans_lane_idx").on(
      t.companyId,
      sql`lower(${t.source})`,
      sql`lower(${t.destination})`,
      t.vehicleTypeId,
    ),
  ],
).enableRLS();

export const challanLrs = pgTable(
  "challan_lrs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyId(),
    challanId: uuid("challan_id").notNull(),
    lrId: uuid("lr_id").notNull(),
    loadedPkgs: integer("loaded_pkgs").notNull().default(0),
    loadedWt: numeric("loaded_wt", { precision: 12, scale: 3 }),
    deliveredPkgs: integer("delivered_pkgs"),
    freightAllocated: money("freight_allocated").notNull().default("0"),
    ewbNo: text("ewb_no"),
    ewbDate: date("ewb_date", { mode: "string" }),
    ewbValidUpto: ts("ewb_valid_upto"),
    /** Set when the LR moves to another challan (vehicle change / transshipment). */
    transferredToChallanId: uuid("transferred_to_challan_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(byUser),
  },
  (t) => [
    ...companyFk("challan_lrs_challan", t.companyId, t.challanId, challans, false),
    ...companyFk("challan_lrs_lr", t.companyId, t.lrId, lrs),
    ...companyFk("challan_lrs_transfer", t.companyId, t.transferredToChallanId, challans),
    uniqueIndex("challan_lrs_challan_lr_key").on(t.challanId, t.lrId),
    check(
      "challan_lrs_qty_check",
      sql`loaded_pkgs >= 0 and (delivered_pkgs is null or delivered_pkgs >= 0) and (loaded_wt is null or loaded_wt >= 0)`,
    ),
    check("challan_lrs_freight_check", sql`freight_allocated >= 0`),
    check(
      "challan_lrs_delivered_check",
      sql`delivered_pkgs is null or delivered_pkgs <= loaded_pkgs`,
    ),
    check("challan_lrs_ewb_check", sql`ewb_no is null or ewb_no ~ '^[0-9]{12}$'`),
    index("challan_lrs_company_ewb_idx")
      .on(t.companyId, t.ewbValidUpto)
      .where(sql`ewb_valid_upto is not null and transferred_to_challan_id is null`),
  ],
).enableRLS();

export const challanCharges = pgTable(
  "challan_charges",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    challanId: uuid("challan_id").notNull(),
    lrId: uuid("lr_id"),
    /** Null only on system lines (auto_kind set). */
    chargeTypeId: uuid("charge_type_id"),
    stage: chargeStage("stage").notNull(),
    direction: chargeDirection("direction").notNull(),
    /** What the truck is paid (ADD) or charged (DEDUCT). */
    amount: money("amount").notNull().default("0"),
    billParty: boolean("bill_party").notNull().default(false),
    /** What goes on the party's freight bill; blank unless the user fills it. */
    partyAmount: money("party_amount"),
    billedInFreightBillId: uuid("billed_in_freight_bill_id"),
    evidenceFile: text("evidence_file"),
    note: text("note"),
    /** System POD line: late-POD fee (challan-level) or shortage (per LR). */
    autoKind: podAutoKind("auto_kind"),
    /** What the rule computed; `amount` differs only when override_reason is set. */
    autoAmount: money("auto_amount"),
    overrideReason: text("override_reason"),
  },
  (t) => [
    ...businessConstraints("challan_charges", t),
    check("challan_charges_type_check", sql`charge_type_id is not null or auto_kind is not null`),
    check(
      "challan_charges_auto_check",
      sql`(auto_kind is null) = (auto_amount is null) and (auto_amount is null or auto_amount >= 0) and (override_reason is null or auto_kind is not null) and (auto_kind is null or stage = 'pod')`,
    ),
    check("challan_charges_party_lr_check", sql`not bill_party or lr_id is not null`),
    uniqueIndex("challan_charges_auto_key")
      .on(
        t.companyId,
        t.challanId,
        t.autoKind,
        sql`coalesce(${t.lrId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`auto_kind is not null and cancelled_at is null`),
    index("challan_charges_bill_idx")
      .on(t.companyId, t.billedInFreightBillId)
      .where(sql`billed_in_freight_bill_id is not null`),
    ...companyFk("challan_charges_challan", t.companyId, t.challanId, challans),
    ...companyFk("challan_charges_lr", t.companyId, t.lrId, lrs),
    ...companyFk("challan_charges_type", t.companyId, t.chargeTypeId, chargeTypes, false),
    ...companyFk(
      "challan_charges_bill",
      t.companyId,
      t.billedInFreightBillId,
      freightBills,
      false,
    ),
    check("challan_charges_amount_check", sql`amount >= 0 and (party_amount is null or party_amount >= 0)`),
    check(
      "challan_charges_bill_check",
      sql`not bill_party or (party_amount is not null and party_amount > 0)`,
    ),
    check(
      "challan_charges_billed_check",
      sql`billed_in_freight_bill_id is null or bill_party`,
    ),
    index("challan_charges_unbilled_idx")
      .on(t.companyId, t.challanId)
      .where(sql`bill_party and billed_in_freight_bill_id is null and cancelled_at is null`),
  ],
).enableRLS();

export const truckPayments = pgTable(
  "truck_payments",
  {
    ...businessColumns(byUser),
    companyId: companyId(),
    branchId: uuid("branch_id").notNull(),
    /** Voucher number, allocated at approval (null while draft / pending approval). */
    paymentNo: text("payment_no"),
    paymentFy: text("payment_fy").notNull(),
    paymentSeq: bigint("payment_seq", { mode: "number" }),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    payeePartyId: uuid("payee_party_id").notNull(),
    mode: truckPaymentMode("mode").notNull(),
    pumpId: uuid("pump_id"),
    /** Company bank account the money left from (no bank-accounts master yet — free reference). */
    bankAccountId: uuid("bank_account_id"),
    refNo: text("ref_no"),
    chequeDate: date("cheque_date", { mode: "string" }),
    amount: money("amount").notNull(),
    tdsAmount: money("tds_amount").notNull().default("0"),
    /** Manual TDS %, default 0, balance lines only (0017_truck_payments.sql). */
    tdsPercent: numeric("tds_percent", { precision: 6, scale: 3 }).notNull().default("0"),
    upiId: text("upi_id"),
    upiQrFile: text("upi_qr_file"),
    /** Payee details frozen at approval (voucher). */
    payeeSnapshot: jsonb("payee_snapshot"),
    /** Safeguard warnings shown / confirmed when the payment was saved. */
    warnings: jsonb("warnings").notNull().default(sql`'[]'::jsonb`),
    podOverrideReason: text("pod_override_reason"),
    narration: text("narration"),
    status: truckPaymentStatus("status").notNull().default("draft"),
    approvedBy: uuid("approved_by").references(byUser),
    approvedAt: ts("approved_at"),
    paidAt: ts("paid_at"),
    paidBy: uuid("paid_by").references(byUser),
    reversedAt: ts("reversed_at"),
    reversedBy: uuid("reversed_by").references(byUser),
    reversalReason: text("reversal_reason"),
  },
  (t) => [
    ...businessConstraints("truck_payments", t),
    ...companyFk("truck_payments_branch", t.companyId, t.branchId, branches, false),
    ...companyFk("truck_payments_payee", t.companyId, t.payeePartyId, truckParties, false),
    ...companyFk("truck_payments_pump", t.companyId, t.pumpId, pumps),
    uniqueIndex("truck_payments_no_key").on(t.companyId, t.branchId, t.paymentFy, t.paymentNo),
    uniqueIndex("truck_payments_seq_key")
      .on(t.companyId, t.branchId, t.paymentFy, t.paymentSeq)
      .where(sql`payment_seq is not null`),
    check("truck_payments_fy_check", sql`payment_fy ~ ${sql.raw(`'${FY_SQL}'`)}`),
    check("truck_payments_amount_check", sql`amount > 0 and tds_amount >= 0`),
    check("truck_payments_diesel_check", sql`(mode = 'diesel') = (pump_id is not null)`),
    check(
      "truck_payments_approval_check",
      sql`(approved_by is null) = (approved_at is null)`,
    ),
    check("truck_payments_tds_percent_check", sql`tds_percent >= 0 and tds_percent <= 100`),
    check(
      "truck_payments_number_check",
      sql`(payment_no is null) = (status in ('draft', 'pending_approval'))`,
    ),
    check(
      "truck_payments_cheque_check",
      sql`mode <> 'cheque' or (ref_no is not null and cheque_date is not null)`,
    ),
    check("truck_payments_paid_check", sql`status <> 'paid' or paid_at is not null`),
    check(
      "truck_payments_reversed_check",
      sql`(status = 'reversed') = (reversed_at is not null) and (reversed_at is null or reversal_reason is not null)`,
    ),
    index("truck_payments_payee_idx").on(t.companyId, t.payeePartyId, t.paidOn.desc()),
    index("truck_payments_company_status_idx").on(t.companyId, t.status),
    // Duplicate-payment guard lookup (same payee + amount within a day).
    index("truck_payments_dup_idx").on(t.companyId, t.payeePartyId, t.amount, t.paidOn),
  ],
).enableRLS();

export const truckPaymentAllocations = pgTable(
  "truck_payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyId(),
    paymentId: uuid("payment_id").notNull(),
    challanId: uuid("challan_id").notNull(),
    kind: allocationKind("kind").notNull(),
    amount: money("amount").notNull(),
    /** Only on BALANCE allocations — no TDS on advances. */
    tdsAmount: money("tds_amount").notNull().default("0"),
  },
  (t) => [
    ...companyFk("truck_payment_allocations_payment", t.companyId, t.paymentId, truckPayments, false),
    ...companyFk("truck_payment_allocations_challan", t.companyId, t.challanId, challans),
    uniqueIndex("truck_payment_allocations_key").on(t.paymentId, t.challanId, t.kind),
    check("truck_payment_allocations_amount_check", sql`tds_amount >= 0`),
    check(
      "truck_payment_allocations_tds_check",
      sql`tds_amount = 0 or kind = 'balance'`,
    ),
  ],
).enableRLS();

/** Read-only owner statement links. Only a hash of the token is stored. */
export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyId(),
    partyId: uuid("party_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    lastOpenedAt: ts("last_opened_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(byUser),
  },
  (t) => [
    ...companyFk("share_links_party", t.companyId, t.partyId, truckParties),
    uniqueIndex("share_links_token_key").on(t.tokenHash),
  ],
).enableRLS();

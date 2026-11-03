CREATE TYPE "public"."allocation_kind" AS ENUM('advance', 'balance', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."challan_status" AS ENUM('draft', 'dispatched', 'in_transit', 'reached', 'pod_received', 'settled');--> statement-breakpoint
CREATE TYPE "public"."charge_direction" AS ENUM('add', 'deduct');--> statement-breakpoint
CREATE TYPE "public"."charge_stage" AS ENUM('hire', 'pod');--> statement-breakpoint
CREATE TYPE "public"."hire_series_kind" AS ENUM('challan', 'truck_payment');--> statement-breakpoint
CREATE TYPE "public"."payee_kind" AS ENUM('owner', 'broker');--> statement-breakpoint
CREATE TYPE "public"."rate_basis" AS ENUM('trip', 'per_tonne');--> statement-breakpoint
CREATE TYPE "public"."truck_party_role" AS ENUM('owner', 'broker', 'both');--> statement-breakpoint
CREATE TYPE "public"."truck_party_status" AS ENUM('active', 'blacklisted');--> statement-breakpoint
CREATE TYPE "public"."truck_payment_mode" AS ENUM('bank', 'upi', 'cash', 'cheque', 'diesel');--> statement-breakpoint
CREATE TYPE "public"."truck_payment_status" AS ENUM('draft', 'pending_approval', 'approved', 'paid', 'reversed');--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"address" text,
	CONSTRAINT "branches_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "branches_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null)
);
--> statement-breakpoint
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "challan_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"challan_id" uuid NOT NULL,
	"lr_id" uuid,
	"charge_type_id" uuid NOT NULL,
	"stage" charge_stage NOT NULL,
	"direction" charge_direction NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"bill_party" boolean DEFAULT false NOT NULL,
	"party_amount" numeric(14, 2),
	"billed_in_freight_bill_id" uuid,
	"evidence_file" text,
	"note" text,
	CONSTRAINT "challan_charges_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "challan_charges_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "challan_charges_amount_check" CHECK (amount >= 0 and (party_amount is null or party_amount >= 0)),
	CONSTRAINT "challan_charges_bill_check" CHECK (not bill_party or (party_amount is not null and party_amount > 0)),
	CONSTRAINT "challan_charges_billed_check" CHECK (billed_in_freight_bill_id is null or bill_party)
);
--> statement-breakpoint
ALTER TABLE "challan_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "challan_lrs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"challan_id" uuid NOT NULL,
	"lr_id" uuid NOT NULL,
	"loaded_pkgs" integer DEFAULT 0 NOT NULL,
	"loaded_wt" numeric(12, 3),
	"delivered_pkgs" integer,
	"freight_allocated" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ewb_no" text,
	"ewb_date" date,
	"ewb_valid_upto" timestamp with time zone,
	"transferred_to_challan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "challan_lrs_qty_check" CHECK (loaded_pkgs >= 0 and (delivered_pkgs is null or delivered_pkgs >= 0) and (loaded_wt is null or loaded_wt >= 0)),
	CONSTRAINT "challan_lrs_freight_check" CHECK (freight_allocated >= 0),
	CONSTRAINT "challan_lrs_ewb_check" CHECK (ewb_no is null or ewb_no ~ '^[0-9]{12}$')
);
--> statement-breakpoint
ALTER TABLE "challan_lrs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "challans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"challan_no" text NOT NULL,
	"challan_fy" text NOT NULL,
	"challan_seq" bigint,
	"challan_at" timestamp with time zone DEFAULT now() NOT NULL,
	"branch_id" uuid NOT NULL,
	"source" text,
	"destination" text,
	"vehicle_id" uuid,
	"vehicle_type_id" uuid,
	"driver_id" uuid,
	"broker_id" uuid,
	"payee_party_id" uuid,
	"payee_kind" "payee_kind" DEFAULT 'owner' NOT NULL,
	"rate_basis" "rate_basis" DEFAULT 'trip' NOT NULL,
	"rate" numeric(14, 2) DEFAULT '0' NOT NULL,
	"qty_tonnes" numeric(12, 3),
	"hire_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"remarks" text,
	"status" "challan_status" DEFAULT 'draft' NOT NULL,
	"dispatched_at" timestamp with time zone,
	"reported_at" timestamp with time zone,
	"unloaded_at" timestamp with time zone,
	"pod_received_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"ewb_alert_hours" integer,
	"late_pod_days" integer,
	"late_pod_fee" numeric(14, 2),
	CONSTRAINT "challans_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "challans_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "challans_fy_check" CHECK (challan_fy ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "challans_amounts_check" CHECK (rate >= 0 and hire_amount >= 0),
	CONSTRAINT "challans_qty_check" CHECK (qty_tonnes is null or qty_tonnes >= 0),
	CONSTRAINT "challans_per_tonne_check" CHECK (rate_basis <> 'per_tonne' or qty_tonnes is not null)
);
--> statement-breakpoint
ALTER TABLE "challans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "charge_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"default_direction" charge_direction NOT NULL,
	"default_bill_party" boolean DEFAULT false NOT NULL,
	"stage" charge_stage NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	CONSTRAINT "charge_types_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "charge_types_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null)
);
--> statement-breakpoint
ALTER TABLE "charge_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hire_number_series" (
	"company_id" uuid NOT NULL,
	"doc_type" "hire_series_kind" NOT NULL,
	"branch_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"next_no" bigint DEFAULT 1 NOT NULL,
	"padding" smallint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hire_number_series_pkey" PRIMARY KEY("company_id","doc_type","branch_id","fy"),
	CONSTRAINT "hire_number_series_fy_check" CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "hire_number_series_next_no_check" CHECK (next_no >= 1),
	CONSTRAINT "hire_number_series_padding_check" CHECK (padding between 0 and 12)
);
--> statement-breakpoint
ALTER TABLE "hire_number_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market_drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mobile" text,
	"dl_no" text,
	"dl_upto" date,
	"dl_file" text,
	CONSTRAINT "market_drivers_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "market_drivers_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "market_drivers_mobile_check" CHECK (mobile is null or mobile ~ '^[0-9]{10}$')
);
--> statement-breakpoint
ALTER TABLE "market_drivers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"vehicle_no" text NOT NULL,
	"owner_party_id" uuid,
	"vehicle_type_id" uuid,
	"capacity_kg" integer,
	"rc_owner_name" text,
	"insurance_upto" date,
	"fitness_upto" date,
	"permit_upto" date,
	"puc_upto" date,
	"rc_file" text,
	"extracted_json" jsonb,
	"last_verified_at" timestamp with time zone,
	CONSTRAINT "market_vehicles_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "market_vehicles_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "market_vehicles_no_check" CHECK (vehicle_no ~ '^[A-Z0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "market_vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pumps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"ledger_ref" text,
	CONSTRAINT "pumps_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "pumps_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null)
);
--> statement-breakpoint
ALTER TABLE "pumps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "share_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tds_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"file_url" text,
	"vehicles_owned_declared" integer,
	"received_on" date,
	CONSTRAINT "tds_declarations_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "tds_declarations_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "tds_declarations_fy_check" CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "tds_declarations_vehicles_check" CHECK (vehicles_owned_declared is null or vehicles_owned_declared >= 0)
);
--> statement-breakpoint
ALTER TABLE "tds_declarations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "truck_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"role" "truck_party_role" DEFAULT 'owner' NOT NULL,
	"name" text NOT NULL,
	"mobile" text,
	"alt_mobile" text,
	"pan" text,
	"pan_type" text GENERATED ALWAYS AS (case when pan is null then null when substr(pan, 4, 1) = 'P' then 'individual' when substr(pan, 4, 1) = 'H' then 'huf' else 'other' end) STORED,
	"gstin" text,
	"address" text,
	"bank_name" text,
	"account_no" text,
	"ifsc" text,
	"account_holder" text,
	"upi_id" text,
	"upi_qr_file" text,
	"bank_changed_at" timestamp with time zone,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"status" "truck_party_status" DEFAULT 'active' NOT NULL,
	"blacklist_reason" text,
	"rating" smallint,
	"rating_notes" text,
	"notes" text,
	"search_text" text GENERATED ALWAYS AS (lower(coalesce(name, '') || ' ' || coalesce(mobile, '') || ' ' || coalesce(pan, ''))) STORED,
	CONSTRAINT "truck_parties_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "truck_parties_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "truck_parties_pan_check" CHECK (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
	CONSTRAINT "truck_parties_gstin_check" CHECK (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$'),
	CONSTRAINT "truck_parties_mobile_check" CHECK (mobile is null or mobile ~ '^[0-9]{10}$'),
	CONSTRAINT "truck_parties_rating_check" CHECK (rating is null or rating between 1 and 5),
	CONSTRAINT "truck_parties_blacklist_check" CHECK (status <> 'blacklisted' or blacklist_reason is not null)
);
--> statement-breakpoint
ALTER TABLE "truck_parties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "truck_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"challan_id" uuid NOT NULL,
	"kind" "allocation_kind" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"tds_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "truck_payment_allocations_amount_check" CHECK (tds_amount >= 0),
	CONSTRAINT "truck_payment_allocations_tds_check" CHECK (tds_amount = 0 or kind = 'balance')
);
--> statement-breakpoint
ALTER TABLE "truck_payment_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "truck_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"payment_no" text NOT NULL,
	"payment_fy" text NOT NULL,
	"payment_seq" bigint,
	"paid_on" date NOT NULL,
	"payee_party_id" uuid NOT NULL,
	"mode" "truck_payment_mode" NOT NULL,
	"pump_id" uuid,
	"bank_account_id" uuid,
	"ref_no" text,
	"cheque_date" date,
	"amount" numeric(14, 2) NOT NULL,
	"tds_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"narration" text,
	"status" "truck_payment_status" DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	CONSTRAINT "truck_payments_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "truck_payments_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "truck_payments_fy_check" CHECK (payment_fy ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "truck_payments_amount_check" CHECK (amount > 0 and tds_amount >= 0),
	CONSTRAINT "truck_payments_diesel_check" CHECK ((mode = 'diesel') = (pump_id is not null)),
	CONSTRAINT "truck_payments_approval_check" CHECK ((approved_by is null) = (approved_at is null))
);
--> statement-breakpoint
ALTER TABLE "truck_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vehicle_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity_kg" integer,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vehicle_types_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "vehicle_types_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null)
);
--> statement-breakpoint
ALTER TABLE "vehicle_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "min_margin_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "rate_outlier_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tds_section_label" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tds_rate_individual_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tds_rate_other_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tds_rate_no_pan_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tds_threshold" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tds_nil_max_vehicles" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tds_timing" text DEFAULT 'balance' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tds_base" text DEFAULT 'gross_credit' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "shortage_allowance_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "shortage_rate_source" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "detention_free_days" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "detention_rate_per_day" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "late_pod_days" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "late_pod_fee" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "cash_warning_limit" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "maker_checker_limit" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "bank_change_cooling_hours" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "ewb_alert_hours" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "ewb_km_per_day" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "ewb_odc_km_per_day" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "bank_file_template" jsonb;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "ledger_mapping" jsonb;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_charges" ADD CONSTRAINT "challan_charges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_charges" ADD CONSTRAINT "challan_charges_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_charges" ADD CONSTRAINT "challan_charges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_charges" ADD CONSTRAINT "challan_charges_challan_fk" FOREIGN KEY ("company_id","challan_id") REFERENCES "public"."challans"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_charges" ADD CONSTRAINT "challan_charges_lr_fk" FOREIGN KEY ("company_id","lr_id") REFERENCES "public"."lrs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_charges" ADD CONSTRAINT "challan_charges_type_fk" FOREIGN KEY ("company_id","charge_type_id") REFERENCES "public"."charge_types"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_charges" ADD CONSTRAINT "challan_charges_bill_fk" FOREIGN KEY ("company_id","billed_in_freight_bill_id") REFERENCES "public"."freight_bills"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_lrs" ADD CONSTRAINT "challan_lrs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_lrs" ADD CONSTRAINT "challan_lrs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_lrs" ADD CONSTRAINT "challan_lrs_challan_fk" FOREIGN KEY ("company_id","challan_id") REFERENCES "public"."challans"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_lrs" ADD CONSTRAINT "challan_lrs_lr_fk" FOREIGN KEY ("company_id","lr_id") REFERENCES "public"."lrs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challan_lrs" ADD CONSTRAINT "challan_lrs_transfer_fk" FOREIGN KEY ("company_id","transferred_to_challan_id") REFERENCES "public"."challans"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challans" ADD CONSTRAINT "challans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challans" ADD CONSTRAINT "challans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challans" ADD CONSTRAINT "challans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challans" ADD CONSTRAINT "challans_branch_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challans" ADD CONSTRAINT "challans_vehicle_fk" FOREIGN KEY ("company_id","vehicle_id") REFERENCES "public"."market_vehicles"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challans" ADD CONSTRAINT "challans_vehicle_type_fk" FOREIGN KEY ("company_id","vehicle_type_id") REFERENCES "public"."vehicle_types"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challans" ADD CONSTRAINT "challans_driver_fk" FOREIGN KEY ("company_id","driver_id") REFERENCES "public"."market_drivers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challans" ADD CONSTRAINT "challans_broker_fk" FOREIGN KEY ("company_id","broker_id") REFERENCES "public"."truck_parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challans" ADD CONSTRAINT "challans_payee_fk" FOREIGN KEY ("company_id","payee_party_id") REFERENCES "public"."truck_parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_types" ADD CONSTRAINT "charge_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_types" ADD CONSTRAINT "charge_types_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_types" ADD CONSTRAINT "charge_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_number_series" ADD CONSTRAINT "hire_number_series_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_number_series" ADD CONSTRAINT "hire_number_series_branch_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_drivers" ADD CONSTRAINT "market_drivers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_drivers" ADD CONSTRAINT "market_drivers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_drivers" ADD CONSTRAINT "market_drivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_vehicles" ADD CONSTRAINT "market_vehicles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_vehicles" ADD CONSTRAINT "market_vehicles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_vehicles" ADD CONSTRAINT "market_vehicles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_vehicles" ADD CONSTRAINT "market_vehicles_owner_fk" FOREIGN KEY ("company_id","owner_party_id") REFERENCES "public"."truck_parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_vehicles" ADD CONSTRAINT "market_vehicles_type_fk" FOREIGN KEY ("company_id","vehicle_type_id") REFERENCES "public"."vehicle_types"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pumps" ADD CONSTRAINT "pumps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pumps" ADD CONSTRAINT "pumps_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pumps" ADD CONSTRAINT "pumps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_party_fk" FOREIGN KEY ("company_id","party_id") REFERENCES "public"."truck_parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_declarations" ADD CONSTRAINT "tds_declarations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_declarations" ADD CONSTRAINT "tds_declarations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_declarations" ADD CONSTRAINT "tds_declarations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_declarations" ADD CONSTRAINT "tds_declarations_party_fk" FOREIGN KEY ("company_id","party_id") REFERENCES "public"."truck_parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_parties" ADD CONSTRAINT "truck_parties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_parties" ADD CONSTRAINT "truck_parties_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_parties" ADD CONSTRAINT "truck_parties_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_parties" ADD CONSTRAINT "truck_parties_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_payment_allocations" ADD CONSTRAINT "truck_payment_allocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_payment_allocations" ADD CONSTRAINT "truck_payment_allocations_payment_fk" FOREIGN KEY ("company_id","payment_id") REFERENCES "public"."truck_payments"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_payment_allocations" ADD CONSTRAINT "truck_payment_allocations_challan_fk" FOREIGN KEY ("company_id","challan_id") REFERENCES "public"."challans"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_payments" ADD CONSTRAINT "truck_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_payments" ADD CONSTRAINT "truck_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_payments" ADD CONSTRAINT "truck_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_payments" ADD CONSTRAINT "truck_payments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_payments" ADD CONSTRAINT "truck_payments_branch_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "public"."branches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_payments" ADD CONSTRAINT "truck_payments_payee_fk" FOREIGN KEY ("company_id","payee_party_id") REFERENCES "public"."truck_parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_payments" ADD CONSTRAINT "truck_payments_pump_fk" FOREIGN KEY ("company_id","pump_id") REFERENCES "public"."pumps"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_types" ADD CONSTRAINT "vehicle_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_types" ADD CONSTRAINT "vehicle_types_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_types" ADD CONSTRAINT "vehicle_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_company_name_key" ON "branches" USING btree ("company_id",lower("name")) WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "challan_charges_challan_idx" ON "challan_charges" USING btree ("company_id","challan_id");--> statement-breakpoint
CREATE INDEX "challan_charges_lr_idx" ON "challan_charges" USING btree ("company_id","lr_id");--> statement-breakpoint
CREATE INDEX "challan_charges_unbilled_idx" ON "challan_charges" USING btree ("company_id","challan_id") WHERE bill_party and billed_in_freight_bill_id is null and cancelled_at is null;--> statement-breakpoint
CREATE INDEX "challan_lrs_lr_idx" ON "challan_lrs" USING btree ("company_id","lr_id");--> statement-breakpoint
CREATE INDEX "challan_lrs_transfer_idx" ON "challan_lrs" USING btree ("company_id","transferred_to_challan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "challan_lrs_challan_lr_key" ON "challan_lrs" USING btree ("challan_id","lr_id");--> statement-breakpoint
CREATE INDEX "challan_lrs_company_ewb_idx" ON "challan_lrs" USING btree ("company_id","ewb_valid_upto") WHERE ewb_valid_upto is not null and transferred_to_challan_id is null;--> statement-breakpoint
CREATE INDEX "challans_branch_idx" ON "challans" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "challans_vehicle_idx" ON "challans" USING btree ("company_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "challans_vehicle_type_idx" ON "challans" USING btree ("company_id","vehicle_type_id");--> statement-breakpoint
CREATE INDEX "challans_driver_idx" ON "challans" USING btree ("company_id","driver_id");--> statement-breakpoint
CREATE INDEX "challans_broker_idx" ON "challans" USING btree ("company_id","broker_id");--> statement-breakpoint
CREATE INDEX "challans_payee_idx" ON "challans" USING btree ("company_id","payee_party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "challans_no_key" ON "challans" USING btree ("company_id","branch_id","challan_fy","challan_no");--> statement-breakpoint
CREATE UNIQUE INDEX "challans_seq_key" ON "challans" USING btree ("company_id","branch_id","challan_fy","challan_seq") WHERE challan_seq is not null;--> statement-breakpoint
CREATE INDEX "challans_company_at_idx" ON "challans" USING btree ("company_id","challan_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "challans_company_status_idx" ON "challans" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "challans_lane_idx" ON "challans" USING btree ("company_id",lower("source"),lower("destination"),"vehicle_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "charge_types_company_code_key" ON "charge_types" USING btree ("company_id",lower("code")) WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "market_drivers_company_mobile_idx" ON "market_drivers" USING btree ("company_id","mobile") WHERE mobile is not null;--> statement-breakpoint
CREATE INDEX "market_drivers_dl_upto_idx" ON "market_drivers" USING btree ("company_id","dl_upto") WHERE cancelled_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "market_vehicles_company_no_key" ON "market_vehicles" USING btree ("company_id","vehicle_no") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "market_vehicles_owner_idx" ON "market_vehicles" USING btree ("company_id","owner_party_id");--> statement-breakpoint
CREATE INDEX "market_vehicles_type_idx" ON "market_vehicles" USING btree ("company_id","vehicle_type_id");--> statement-breakpoint
CREATE INDEX "market_vehicles_insurance_idx" ON "market_vehicles" USING btree ("company_id","insurance_upto") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "market_vehicles_fitness_idx" ON "market_vehicles" USING btree ("company_id","fitness_upto") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "market_vehicles_permit_idx" ON "market_vehicles" USING btree ("company_id","permit_upto") WHERE cancelled_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pumps_company_name_key" ON "pumps" USING btree ("company_id",lower("name")) WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "share_links_party_idx" ON "share_links" USING btree ("company_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tds_declarations_party_fy_key" ON "tds_declarations" USING btree ("company_id","party_id","fy") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "truck_parties_company_name_idx" ON "truck_parties" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE INDEX "truck_parties_company_pan_idx" ON "truck_parties" USING btree ("company_id","pan") WHERE pan is not null;--> statement-breakpoint
CREATE INDEX "truck_payment_allocations_challan_idx" ON "truck_payment_allocations" USING btree ("company_id","challan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "truck_payment_allocations_key" ON "truck_payment_allocations" USING btree ("payment_id","challan_id","kind");--> statement-breakpoint
CREATE INDEX "truck_payments_pump_idx" ON "truck_payments" USING btree ("company_id","pump_id");--> statement-breakpoint
CREATE UNIQUE INDEX "truck_payments_no_key" ON "truck_payments" USING btree ("company_id","branch_id","payment_fy","payment_no");--> statement-breakpoint
CREATE UNIQUE INDEX "truck_payments_seq_key" ON "truck_payments" USING btree ("company_id","branch_id","payment_fy","payment_seq") WHERE payment_seq is not null;--> statement-breakpoint
CREATE INDEX "truck_payments_payee_idx" ON "truck_payments" USING btree ("company_id","payee_party_id","paid_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "truck_payments_company_status_idx" ON "truck_payments" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "truck_payments_dup_idx" ON "truck_payments" USING btree ("company_id","payee_party_id","amount","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_types_company_name_key" ON "vehicle_types" USING btree ("company_id",lower("name")) WHERE cancelled_at is null;
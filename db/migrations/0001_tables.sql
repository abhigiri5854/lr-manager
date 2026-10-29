CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'cancel');--> statement-breakpoint
CREATE TYPE "public"."audit_actor" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."charged_as" AS ENUM('ftl', 'per_kg', 'per_pkg');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TYPE "public"."freight_gst_mode" AS ENUM('reverse_charge', 'forward_charge');--> statement-breakpoint
CREATE TYPE "public"."gst_payer" AS ENUM('consignor', 'consignee', 'transporter');--> statement-breakpoint
CREATE TYPE "public"."import_detected_as" AS ENUM('booking_report', 'tax_invoice', 'lr', 'pod', 'eway_bill', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."import_format" AS ENUM('xlsx', 'xls', 'csv', 'pdf', 'jpg', 'png');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('excel', 'csv', 'pdf', 'image');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('excel', 'document');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'read', 'reviewed', 'imported', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lr_payment_mode" AS ENUM('to_pay', 'paid', 'tbb');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'accountant', 'booking_staff', 'driver');--> statement-breakpoint
CREATE TYPE "public"."number_series_kind" AS ENUM('lr', 'freight_bill', 'tax_invoice');--> statement-breakpoint
CREATE TYPE "public"."pod_condition" AS ENUM('good', 'short', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."receipt_mode" AS ENUM('neft_upi', 'cheque', 'cash');--> statement-breakpoint
CREATE TYPE "public"."record_source" AS ENUM('manual', 'lr', 'invoice_scan', 'excel_import');--> statement-breakpoint
CREATE TYPE "public"."risk" AS ENUM('owner', 'carrier');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" "audit_actor" NOT NULL,
	"user_id" uuid,
	"batch_id" uuid,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "audit_log_actor_check" CHECK ((actor = 'user') = (user_id is not null))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "freight_bill_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"freight_bill_id" uuid NOT NULL,
	"lr_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"freight_paise" bigint NOT NULL,
	"detention_paise" bigint DEFAULT 0 NOT NULL,
	"other_paise" bigint DEFAULT 0 NOT NULL,
	"advance_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"bill_cancelled_at" timestamp with time zone,
	CONSTRAINT "freight_bill_lines_position_key" UNIQUE("freight_bill_id","position"),
	CONSTRAINT "freight_bill_lines_amounts_check" CHECK (freight_paise >= 0 and detention_paise >= 0 and other_paise >= 0 and advance_paise >= 0 and total_paise >= 0)
);
--> statement-breakpoint
ALTER TABLE "freight_bill_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "freight_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"bill_no" text,
	"bill_fy" text,
	"bill_seq" bigint,
	"bill_date" date NOT NULL,
	"party_id" uuid NOT NULL,
	"gst_mode" "freight_gst_mode" NOT NULL,
	"gst_rate_bp" integer DEFAULT 0 NOT NULL,
	"snapshot" jsonb,
	"charges_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"advance_paise" bigint DEFAULT 0 NOT NULL,
	"amount_paise" bigint DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	CONSTRAINT "freight_bills_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "freight_bills_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "freight_bills_final_check" CHECK (status = 'draft' or (bill_no is not null and snapshot is not null)),
	CONSTRAINT "freight_bills_amounts_check" CHECK (charges_paise >= 0 and sgst_paise >= 0 and cgst_paise >= 0 and igst_paise >= 0 and advance_paise >= 0),
	CONSTRAINT "freight_bills_gst_rate_check" CHECK (gst_rate_bp between 0 and 2800),
	CONSTRAINT "freight_bills_fy_check" CHECK (bill_fy is null or bill_fy ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "freight_bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"freight_bill_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	CONSTRAINT "payment_allocations_bill_key" UNIQUE("payment_id","freight_bill_id"),
	CONSTRAINT "payment_allocations_amount_check" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
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
	"amount_paise" bigint NOT NULL,
	"tds_paise" bigint DEFAULT 0 NOT NULL,
	"mode" "receipt_mode" NOT NULL,
	"received_on" date NOT NULL,
	"reference" text,
	CONSTRAINT "payments_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "payments_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "payments_amount_check" CHECK (amount_paise > 0),
	CONSTRAINT "payments_tds_check" CHECK (tds_paise >= 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"lr_id" uuid NOT NULL,
	"received_by" text,
	"receiver_phone" text,
	"packages_received" integer,
	"condition" "pod_condition" DEFAULT 'good' NOT NULL,
	"remarks" text,
	"document_paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"received_at" timestamp with time zone,
	CONSTRAINT "pods_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "pods_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "pods_packages_check" CHECK (packages_received is null or packages_received >= 0)
);
--> statement-breakpoint
ALTER TABLE "pods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"label" text NOT NULL,
	"name" text NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"office" text DEFAULT '' NOT NULL,
	"email" text,
	"website" text,
	"mobile1" text,
	"mobile2" text,
	"gstin" text NOT NULL,
	"pan" text NOT NULL,
	"udyam" text,
	"bank_account_name" text,
	"bank_name" text,
	"bank_account_no" text,
	"bank_ifsc" text,
	"invoice_title" text DEFAULT 'FREIGHT INVOICE' NOT NULL,
	"invoice_note" text,
	"freight_bill_prefix" text DEFAULT '' NOT NULL,
	"tax_invoice_prefix" text DEFAULT '' NOT NULL,
	"invoice_round_off" boolean DEFAULT true NOT NULL,
	"numbering_resets_yearly" boolean DEFAULT true NOT NULL,
	"freight_gst_rate_bp" integer DEFAULT 500 NOT NULL,
	"signatory_name" text,
	"lr_prefix" text DEFAULT '' NOT NULL,
	"jurisdiction" text,
	"pod_days" integer,
	"pod_penalty_per_day_paise" bigint,
	"lr_copies" text[] DEFAULT '{}'::text[] NOT NULL,
	"detention" text,
	"lr_terms" text,
	"logo_path" text,
	"use_logo_watermark" boolean DEFAULT false NOT NULL,
	"signature_path" text,
	CONSTRAINT "companies_gstin_check" CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$'),
	CONSTRAINT "companies_pan_check" CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
	CONSTRAINT "companies_bank_check" CHECK (num_nonnulls(bank_account_name, bank_name, bank_account_no, bank_ifsc) in (0, 4)),
	CONSTRAINT "companies_gst_rate_check" CHECK (freight_gst_rate_bp between 0 and 2800),
	CONSTRAINT "companies_pod_days_check" CHECK (pod_days is null or pod_days >= 0),
	CONSTRAINT "companies_pod_penalty_check" CHECK (pod_penalty_per_day_paise is null or pod_penalty_per_day_paise >= 0),
	CONSTRAINT "companies_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null)
);
--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	CONSTRAINT "memberships_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "memberships_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null)
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "number_series" (
	"company_id" uuid NOT NULL,
	"series" "number_series_kind" NOT NULL,
	"fy" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"next_no" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "number_series_pkey" PRIMARY KEY("company_id","series","fy"),
	CONSTRAINT "number_series_fy_check" CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "number_series_next_no_check" CHECK (next_no >= 1)
);
--> statement-breakpoint
ALTER TABLE "number_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" "member_role" NOT NULL,
	"action" text NOT NULL,
	CONSTRAINT "role_permissions_pkey" PRIMARY KEY("role","action")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"mobile" text,
	"email" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "users_mobile_check" CHECK (mobile is null or mobile ~ '^[0-9]{10}$')
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"source" "import_source" NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text,
	"format" "import_format" NOT NULL,
	"kind" "import_kind" NOT NULL,
	"mime_type" text DEFAULT '' NOT NULL,
	"size_bytes" integer NOT NULL,
	"detected_as" "import_detected_as" DEFAULT 'unknown' NOT NULL,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"error" text,
	"result" jsonb,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed_columns" text[] DEFAULT '{}'::text[] NOT NULL,
	"mapping_name" text,
	"row_actions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"count_valid" integer DEFAULT 0 NOT NULL,
	"count_warning" integer DEFAULT 0 NOT NULL,
	"count_error" integer DEFAULT 0 NOT NULL,
	"created_records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imported_at" timestamp with time zone,
	CONSTRAINT "import_batches_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "import_batches_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null)
);
--> statement-breakpoint
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_mappings" (
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
	"columns" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "import_mappings_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "import_mappings_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null)
);
--> statement-breakpoint
ALTER TABLE "import_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tax_invoice_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"item_id" uuid,
	"item_code" text,
	"description" text NOT NULL,
	"hsn" text,
	"uom" text,
	"qty" numeric(14, 3) NOT NULL,
	"rate_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"gst_rate_bp" integer NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "tax_invoice_lines_line_key" UNIQUE("tax_invoice_id","line_no"),
	CONSTRAINT "tax_invoice_lines_amounts_check" CHECK (qty >= 0 and rate_paise >= 0 and discount_paise >= 0 and taxable_paise >= 0 and sgst_paise >= 0 and cgst_paise >= 0 and igst_paise >= 0),
	CONSTRAINT "tax_invoice_lines_gst_rate_check" CHECK (gst_rate_bp between 0 and 2800)
);
--> statement-breakpoint
ALTER TABLE "tax_invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_no" text,
	"invoice_fy" text,
	"invoice_seq" bigint,
	"invoice_at" timestamp with time zone NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"seller_party_id" uuid,
	"bill_to_id" uuid NOT NULL,
	"ship_to_id" uuid,
	"place_of_supply_state_code" char(2) NOT NULL,
	"customer_ref" text,
	"customer_ref_date" date,
	"so_no" text,
	"so_date" date,
	"do_no" text,
	"sap_ref" text,
	"transporter_name" text,
	"truck_id" uuid,
	"driver_mobile" text,
	"ship_from" text,
	"incoterm" text,
	"irn" text,
	"eway_bill_no" text,
	"source_file_path" text,
	"import_batch_id" uuid,
	"snapshot" jsonb,
	"taxable_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"round_off_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	CONSTRAINT "tax_invoices_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "tax_invoices_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "tax_invoices_final_check" CHECK (status = 'draft' or (invoice_no is not null and snapshot is not null)),
	CONSTRAINT "tax_invoices_amounts_check" CHECK (taxable_paise >= 0 and sgst_paise >= 0 and cgst_paise >= 0 and igst_paise >= 0 and total_paise >= 0),
	CONSTRAINT "tax_invoices_fy_check" CHECK (invoice_fy is null or invoice_fy ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "tax_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lr_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"lr_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"invoice_no" text NOT NULL,
	"invoice_date" date,
	"value_paise" bigint,
	"eway_bill_no" text,
	"eway_expires_at" timestamp with time zone,
	"tax_invoice_id" uuid,
	CONSTRAINT "lr_invoices_position_key" UNIQUE("lr_id","position"),
	CONSTRAINT "lr_invoices_eway_check" CHECK (eway_bill_no is null or eway_bill_no ~ '^[0-9]{12}$'),
	CONSTRAINT "lr_invoices_value_check" CHECK (value_paise is null or value_paise >= 0)
);
--> statement-breakpoint
ALTER TABLE "lr_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lr_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"lr_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"item_id" uuid,
	"description" text NOT NULL,
	"packages" integer DEFAULT 0 NOT NULL,
	"actual_weight" numeric(12, 3),
	"charged_weight" numeric(12, 3),
	"size" text,
	CONSTRAINT "lr_items_position_key" UNIQUE("lr_id","position"),
	CONSTRAINT "lr_items_packages_check" CHECK (packages >= 0),
	CONSTRAINT "lr_items_weight_check" CHECK (coalesce(actual_weight, 0) >= 0 and coalesce(charged_weight, 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "lr_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lrs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"import_batch_id" uuid,
	"lr_no" text NOT NULL,
	"lr_fy" text,
	"lr_seq" bigint,
	"lr_date" date,
	"from_place" text,
	"to_place" text,
	"risk" "risk" DEFAULT 'owner' NOT NULL,
	"consignor_id" uuid,
	"consignee_id" uuid,
	"billed_to_id" uuid,
	"gst_paid_by" "gst_payer",
	"payment_mode" "lr_payment_mode",
	"charged_as" charged_as,
	"rate_paise" bigint,
	"truck_id" uuid,
	"driver_mobile" text,
	"remarks" text,
	"freight_paise" bigint,
	"packing_paise" bigint,
	"cn_charge_paise" bigint,
	"loading_paise" bigint,
	"unloading_paise" bigint,
	"detention_paise" bigint,
	"other_paise" bigint,
	"gst_paise" bigint,
	"advance_paise" bigint,
	"booked_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"pod_received_at" timestamp with time zone,
	"billed_at" date,
	"paid_at" date,
	"snapshot" jsonb,
	"search_text" text DEFAULT '' NOT NULL,
	CONSTRAINT "lrs_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "lrs_company_lr_no_key" UNIQUE("company_id","lr_no"),
	CONSTRAINT "lrs_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "lrs_booked_check" CHECK (booked_at is null or (lr_date is not null and snapshot is not null)),
	CONSTRAINT "lrs_charges_check" CHECK (coalesce(freight_paise, 0) >= 0 and coalesce(packing_paise, 0) >= 0 and coalesce(cn_charge_paise, 0) >= 0 and coalesce(loading_paise, 0) >= 0 and coalesce(unloading_paise, 0) >= 0 and coalesce(detention_paise, 0) >= 0 and coalesce(other_paise, 0) >= 0 and coalesce(gst_paise, 0) >= 0 and coalesce(advance_paise, 0) >= 0 and coalesce(rate_paise, 0) >= 0),
	CONSTRAINT "lrs_fy_check" CHECK (lr_fy is null or lr_fy ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "lrs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"mobile" text NOT NULL,
	"name" text,
	"licence_no" text,
	"licence_expiry" date,
	"user_id" uuid,
	"invited_at" timestamp with time zone,
	"search_text" text GENERATED ALWAYS AS (lower(coalesce(name, '') || ' ' || coalesce(licence_no, '') || ' ' || coalesce(mobile, ''))) STORED,
	CONSTRAINT "drivers_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "drivers_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "drivers_mobile_check" CHECK (mobile ~ '^[0-9]{10}$')
);
--> statement-breakpoint
ALTER TABLE "drivers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"hsn" text,
	"uom" text,
	"gst_rate_bp" integer,
	"last_rate_paise" bigint,
	"search_text" text GENERATED ALWAYS AS (lower(coalesce(code, '') || ' ' || coalesce(name, '') || ' ' || coalesce(hsn, ''))) STORED,
	CONSTRAINT "items_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "items_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "items_gst_rate_check" CHECK (gst_rate_bp is null or gst_rate_bp between 0 and 2800),
	CONSTRAINT "items_last_rate_check" CHECK (last_rate_paise is null or last_rate_paise >= 0)
);
--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "parties" (
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
	"place" text,
	"gstin" text,
	"pan" text,
	"phone" text,
	"address" text,
	"state_code" char(2),
	"pincode" text,
	"logo_path" text,
	"default_from" text,
	"default_payment_mode" "lr_payment_mode",
	"default_gst_payer" "gst_payer",
	"default_charged_as" charged_as,
	"source" "record_source" DEFAULT 'manual' NOT NULL,
	"is_self" boolean DEFAULT false NOT NULL,
	"search_text" text GENERATED ALWAYS AS (lower(coalesce(name, '') || ' ' || coalesce(place, '') || ' ' || coalesce(gstin, '') || ' ' || coalesce(phone, ''))) STORED,
	CONSTRAINT "parties_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "parties_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "parties_gstin_check" CHECK (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$')
);
--> statement-breakpoint
ALTER TABLE "parties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"driver_id" uuid,
	"rc_expiry" date,
	"insurance_expiry" date,
	"permit_expiry" date,
	"fitness_expiry" date,
	"source" "record_source" DEFAULT 'manual' NOT NULL,
	CONSTRAINT "trucks_company_id_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "trucks_cancel_reason_check" CHECK (cancel_reason is null or cancelled_at is not null),
	CONSTRAINT "trucks_number_check" CHECK (number ~ '^[A-Z0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "trucks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_batch_fk" FOREIGN KEY ("company_id","batch_id") REFERENCES "public"."import_batches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_bill_lines" ADD CONSTRAINT "freight_bill_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_bill_lines" ADD CONSTRAINT "freight_bill_lines_bill_fk" FOREIGN KEY ("company_id","freight_bill_id") REFERENCES "public"."freight_bills"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_bill_lines" ADD CONSTRAINT "freight_bill_lines_lr_fk" FOREIGN KEY ("company_id","lr_id") REFERENCES "public"."lrs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_bills" ADD CONSTRAINT "freight_bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_bills" ADD CONSTRAINT "freight_bills_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_bills" ADD CONSTRAINT "freight_bills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_bills" ADD CONSTRAINT "freight_bills_party_fk" FOREIGN KEY ("company_id","party_id") REFERENCES "public"."parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_fk" FOREIGN KEY ("company_id","payment_id") REFERENCES "public"."payments"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_bill_fk" FOREIGN KEY ("company_id","freight_bill_id") REFERENCES "public"."freight_bills"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_fk" FOREIGN KEY ("company_id","party_id") REFERENCES "public"."parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pods" ADD CONSTRAINT "pods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pods" ADD CONSTRAINT "pods_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pods" ADD CONSTRAINT "pods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pods" ADD CONSTRAINT "pods_lr_fk" FOREIGN KEY ("company_id","lr_id") REFERENCES "public"."lrs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_invoice_fk" FOREIGN KEY ("company_id","tax_invoice_id") REFERENCES "public"."tax_invoices"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_item_fk" FOREIGN KEY ("company_id","item_id") REFERENCES "public"."items"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_seller_fk" FOREIGN KEY ("company_id","seller_party_id") REFERENCES "public"."parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_bill_to_fk" FOREIGN KEY ("company_id","bill_to_id") REFERENCES "public"."parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_ship_to_fk" FOREIGN KEY ("company_id","ship_to_id") REFERENCES "public"."parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_truck_fk" FOREIGN KEY ("company_id","truck_id") REFERENCES "public"."trucks"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_batch_fk" FOREIGN KEY ("company_id","import_batch_id") REFERENCES "public"."import_batches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lr_invoices" ADD CONSTRAINT "lr_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lr_invoices" ADD CONSTRAINT "lr_invoices_lr_fk" FOREIGN KEY ("company_id","lr_id") REFERENCES "public"."lrs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lr_invoices" ADD CONSTRAINT "lr_invoices_tax_invoice_fk" FOREIGN KEY ("company_id","tax_invoice_id") REFERENCES "public"."tax_invoices"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lr_items" ADD CONSTRAINT "lr_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lr_items" ADD CONSTRAINT "lr_items_lr_fk" FOREIGN KEY ("company_id","lr_id") REFERENCES "public"."lrs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lr_items" ADD CONSTRAINT "lr_items_item_fk" FOREIGN KEY ("company_id","item_id") REFERENCES "public"."items"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lrs" ADD CONSTRAINT "lrs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lrs" ADD CONSTRAINT "lrs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lrs" ADD CONSTRAINT "lrs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lrs" ADD CONSTRAINT "lrs_batch_fk" FOREIGN KEY ("company_id","import_batch_id") REFERENCES "public"."import_batches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lrs" ADD CONSTRAINT "lrs_consignor_fk" FOREIGN KEY ("company_id","consignor_id") REFERENCES "public"."parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lrs" ADD CONSTRAINT "lrs_consignee_fk" FOREIGN KEY ("company_id","consignee_id") REFERENCES "public"."parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lrs" ADD CONSTRAINT "lrs_billed_to_fk" FOREIGN KEY ("company_id","billed_to_id") REFERENCES "public"."parties"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lrs" ADD CONSTRAINT "lrs_truck_fk" FOREIGN KEY ("company_id","truck_id") REFERENCES "public"."trucks"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_driver_fk" FOREIGN KEY ("company_id","driver_id") REFERENCES "public"."drivers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_batch_idx" ON "audit_log" USING btree ("company_id","batch_id");--> statement-breakpoint
CREATE INDEX "audit_log_record_idx" ON "audit_log" USING btree ("company_id","table_name","record_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "freight_bill_lines_bill_idx" ON "freight_bill_lines" USING btree ("company_id","freight_bill_id");--> statement-breakpoint
CREATE INDEX "freight_bill_lines_lr_idx" ON "freight_bill_lines" USING btree ("company_id","lr_id");--> statement-breakpoint
CREATE UNIQUE INDEX "freight_bill_lines_live_lr_key" ON "freight_bill_lines" USING btree ("company_id","lr_id") WHERE bill_cancelled_at is null;--> statement-breakpoint
CREATE INDEX "freight_bills_party_idx" ON "freight_bills" USING btree ("company_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "freight_bills_seq_key" ON "freight_bills" USING btree ("company_id","bill_fy","bill_seq") WHERE bill_seq is not null;--> statement-breakpoint
CREATE INDEX "freight_bills_company_date_idx" ON "freight_bills" USING btree ("company_id","bill_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "freight_bills_company_status_idx" ON "freight_bills" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "payment_allocations" USING btree ("company_id","payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_bill_idx" ON "payment_allocations" USING btree ("company_id","freight_bill_id");--> statement-breakpoint
CREATE INDEX "payments_company_party_received_idx" ON "payments" USING btree ("company_id","party_id","received_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pods_lr_idx" ON "pods" USING btree ("company_id","lr_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pods_live_lr_key" ON "pods" USING btree ("company_id","lr_id") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "pods_company_received_idx" ON "pods" USING btree ("company_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_company_user_key" ON "memberships" USING btree ("company_id","user_id") WHERE cancelled_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_company_key" ON "memberships" USING btree ("user_id","company_id") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "number_series_company_idx" ON "number_series" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_mobile_key" ON "users" USING btree ("mobile") WHERE mobile is not null;--> statement-breakpoint
CREATE INDEX "import_batches_company_created_idx" ON "import_batches" USING btree ("company_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_batches_company_status_idx" ON "import_batches" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "import_batches_created_by_idx" ON "import_batches" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "import_mappings_company_name_key" ON "import_mappings" USING btree ("company_id",lower("name")) WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "tax_invoice_lines_invoice_idx" ON "tax_invoice_lines" USING btree ("company_id","tax_invoice_id");--> statement-breakpoint
CREATE INDEX "tax_invoice_lines_item_idx" ON "tax_invoice_lines" USING btree ("company_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_invoices_own_seq_key" ON "tax_invoices" USING btree ("company_id","invoice_fy","invoice_seq") WHERE seller_party_id is null and invoice_seq is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_invoices_seller_no_key" ON "tax_invoices" USING btree ("company_id",coalesce(seller_party_id, '00000000-0000-0000-0000-000000000000'::uuid),"invoice_fy","invoice_no") WHERE invoice_no is not null;--> statement-breakpoint
CREATE INDEX "tax_invoices_seller_idx" ON "tax_invoices" USING btree ("company_id","seller_party_id");--> statement-breakpoint
CREATE INDEX "tax_invoices_bill_to_idx" ON "tax_invoices" USING btree ("company_id","bill_to_id");--> statement-breakpoint
CREATE INDEX "tax_invoices_ship_to_idx" ON "tax_invoices" USING btree ("company_id","ship_to_id");--> statement-breakpoint
CREATE INDEX "tax_invoices_truck_idx" ON "tax_invoices" USING btree ("company_id","truck_id");--> statement-breakpoint
CREATE INDEX "tax_invoices_batch_idx" ON "tax_invoices" USING btree ("company_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "tax_invoices_company_at_idx" ON "tax_invoices" USING btree ("company_id","invoice_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tax_invoices_company_status_idx" ON "tax_invoices" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "lr_invoices_lr_idx" ON "lr_invoices" USING btree ("company_id","lr_id");--> statement-breakpoint
CREATE INDEX "lr_invoices_tax_invoice_idx" ON "lr_invoices" USING btree ("company_id","tax_invoice_id");--> statement-breakpoint
CREATE INDEX "lr_invoices_eway_expiry_idx" ON "lr_invoices" USING btree ("company_id","eway_expires_at") WHERE eway_bill_no is not null;--> statement-breakpoint
CREATE INDEX "lr_items_lr_idx" ON "lr_items" USING btree ("company_id","lr_id");--> statement-breakpoint
CREATE INDEX "lr_items_item_idx" ON "lr_items" USING btree ("company_id","item_id");--> statement-breakpoint
CREATE INDEX "lrs_batch_idx" ON "lrs" USING btree ("company_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "lrs_consignor_idx" ON "lrs" USING btree ("company_id","consignor_id");--> statement-breakpoint
CREATE INDEX "lrs_consignee_idx" ON "lrs" USING btree ("company_id","consignee_id");--> statement-breakpoint
CREATE INDEX "lrs_billed_to_idx" ON "lrs" USING btree ("company_id","billed_to_id");--> statement-breakpoint
CREATE INDEX "lrs_company_truck_created_idx" ON "lrs" USING btree ("company_id","truck_id","created_at");--> statement-breakpoint
CREATE INDEX "lrs_company_created_idx" ON "lrs" USING btree ("company_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lrs_company_lr_date_idx" ON "lrs" USING btree ("company_id","lr_date");--> statement-breakpoint
CREATE INDEX "lrs_open_idx" ON "lrs" USING btree ("company_id","created_at" DESC NULLS LAST) WHERE cancelled_at is null and delivered_at is null;--> statement-breakpoint
CREATE INDEX "lrs_pod_pending_idx" ON "lrs" USING btree ("company_id","delivered_at") WHERE delivered_at is not null and pod_received_at is null and cancelled_at is null;--> statement-breakpoint
CREATE INDEX "lrs_unbilled_tbb_idx" ON "lrs" USING btree ("company_id") WHERE payment_mode = 'tbb' and booked_at is not null and cancelled_at is null;--> statement-breakpoint
CREATE INDEX "lrs_repeat_routes_idx" ON "lrs" USING btree ("company_id","consignor_id","consignee_id","lr_date" DESC NULLS LAST) WHERE booked_at is not null and cancelled_at is null;--> statement-breakpoint
CREATE INDEX "lrs_company_driver_mobile_idx" ON "lrs" USING btree ("company_id","driver_mobile");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_company_mobile_key" ON "drivers" USING btree ("company_id","mobile") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "drivers_user_idx" ON "drivers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drivers_licence_expiry_idx" ON "drivers" USING btree ("company_id","licence_expiry") WHERE cancelled_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "items_company_code_key" ON "items" USING btree ("company_id",lower("code")) WHERE code is not null and cancelled_at is null;--> statement-breakpoint
CREATE INDEX "items_company_code_prefix_idx" ON "items" USING btree ("company_id",lower("code") text_pattern_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "parties_company_gstin_key" ON "parties" USING btree ("company_id","gstin") WHERE gstin is not null and cancelled_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "parties_company_self_key" ON "parties" USING btree ("company_id") WHERE is_self;--> statement-breakpoint
CREATE INDEX "parties_company_name_idx" ON "parties" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "trucks_company_number_key" ON "trucks" USING btree ("company_id","number") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "trucks_driver_idx" ON "trucks" USING btree ("company_id","driver_id");--> statement-breakpoint
CREATE INDEX "trucks_rc_expiry_idx" ON "trucks" USING btree ("company_id","rc_expiry") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "trucks_insurance_expiry_idx" ON "trucks" USING btree ("company_id","insurance_expiry") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "trucks_permit_expiry_idx" ON "trucks" USING btree ("company_id","permit_expiry") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "trucks_fitness_expiry_idx" ON "trucks" USING btree ("company_id","fitness_expiry") WHERE cancelled_at is null;
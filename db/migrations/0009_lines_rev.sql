ALTER TABLE "freight_bills" ADD COLUMN "lines_rev" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "lines_rev" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD COLUMN "lines_rev" integer DEFAULT 0 NOT NULL;
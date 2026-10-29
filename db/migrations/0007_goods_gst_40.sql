ALTER TABLE "tax_invoice_lines" DROP CONSTRAINT "tax_invoice_lines_gst_rate_check";--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_gst_rate_check";--> statement-breakpoint
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_gst_rate_check" CHECK (gst_rate_bp between 0 and 4000);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_gst_rate_check" CHECK (gst_rate_bp is null or gst_rate_bp between 0 and 4000);
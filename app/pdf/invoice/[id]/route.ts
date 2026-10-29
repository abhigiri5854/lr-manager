import { notOnDatabaseResponse, onDatabase } from "@/lib/data/source";
import { getTaxInvoiceById } from "@/lib/data/invoices";
import { getActiveCompanyId } from "@/lib/data/session";

// Placeholder until the invoice PDF (InvoicePDF.dc.html, rendered with Playwright) is built.
export async function GET(_req: Request, ctx: RouteContext<"/pdf/invoice/[id]">) {
  if (onDatabase()) return notOnDatabaseResponse();
  const { id } = await ctx.params;
  const inv = await getTaxInvoiceById(await getActiveCompanyId(), id);
  if (!inv) return new Response("Invoice not found", { status: 404 });
  return new Response(`The PDF for tax invoice ${inv.invoiceNo ?? "(draft)"} is not built yet.`, {
    status: 501,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

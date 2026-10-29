import { billPdf } from "@/lib/pdf/documents";
import { pdfResponse } from "@/lib/pdf/response";

// Chromium start-up plus the render can take a few seconds on a cold serverless function.
export const maxDuration = 60;

export async function GET(req: Request, ctx: RouteContext<"/pdf/bill/[id]">) {
  const { id } = await ctx.params;
  return pdfResponse(req, id, billPdf);
}

import { paymentPdf } from "@/lib/pdf/documents";
import { pdfResponse } from "@/lib/pdf/response";

export const maxDuration = 60;

export async function GET(req: Request, ctx: RouteContext<"/pdf/payment/[id]">) {
  const { id } = await ctx.params;
  return pdfResponse(req, id, paymentPdf);
}

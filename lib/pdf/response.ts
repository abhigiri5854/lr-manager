// The shared body of the four /pdf/... routes: sign-in and role check, company scoping, then
// inline Preview (default) or Download (?download=1).
import { getActiveCompanyId, getRole } from "@/lib/data/session";
import { can } from "@/lib/permissions";
import type { PdfBuilder } from "./documents";
import { htmlToPdf } from "./render";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });

export async function pdfResponse(req: Request, id: string, build: PdfBuilder): Promise<Response> {
  // Sends a signed-out visitor to /login. Every PDF shows amounts, so it needs "see freight
  // amounts" — every office role has it; drivers (phone app only) do not.
  const companyId = await getActiveCompanyId();
  if (!can(await getRole(companyId), "freight.view")) {
    return text(403, "Your role can't open this document.");
  }
  if (!UUID.test(id)) return text(404, "Document not found.");

  const doc = await build(companyId, id);
  if (!doc) return text(404, "Document not found.");

  let pdf: Uint8Array;
  try {
    pdf = await htmlToPdf(doc.html);
  } catch (e) {
    console.error("PDF render failed", e);
    return text(
      500,
      "The PDF could not be made. On a local machine set CHROME_EXECUTABLE_PATH to your Chrome or Edge, then try again.",
    );
  }
  const download = new URL(req.url).searchParams.has("download");
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${doc.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

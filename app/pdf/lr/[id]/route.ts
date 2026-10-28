// Placeholder until the LR PDF (LRPDF.dc.html, rendered with Playwright) is built in Phase 5.
export async function GET() {
  return new Response("The LR PDF is not built yet.", {
    status: 501,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

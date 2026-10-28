// Placeholder until the POD PDF (PODPDF.dc.html, rendered with Playwright) is built in Phase 5.
export async function GET() {
  return new Response("The POD PDF is not built yet.", {
    status: 501,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

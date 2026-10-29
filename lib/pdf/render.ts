// HTML → PDF with puppeteer-core driving Chromium. On Vercel / Lambda @sparticuz/chromium
// supplies a Chromium that fits the function size limit; on a developer machine set
// CHROME_EXECUTABLE_PATH to an installed Chrome / Edge instead. Server only.
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

const g = globalThis as typeof globalThis & { __lrmBrowser?: Promise<Browser> };

async function launch(): Promise<Browser> {
  const local = process.env.CHROME_EXECUTABLE_PATH?.trim();
  if (local) {
    return puppeteer.launch({
      executablePath: local,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
    });
  }
  return puppeteer.launch({
    executablePath: await chromium.executablePath(),
    headless: "shell",
    args: chromium.args,
  });
}

/** One browser per server process, restarted if it dies. */
function browser(): Promise<Browser> {
  const current = g.__lrmBrowser;
  if (current) return current;
  const next = launch();
  g.__lrmBrowser = next;
  next
    .then((b) => b.on("disconnected", () => (g.__lrmBrowser = undefined)))
    .catch(() => (g.__lrmBrowser = undefined));
  return next;
}

/**
 * Prints a complete HTML document to PDF. Page size and margins come from the document's own
 * @page rule (A4 portrait, or A4 landscape for freight bills). Everything the page needs
 * (fonts, logo, photos) is inlined, so no network is used while printing.
 */
export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    // Embedded fonts can still be decoding when "load" fires.
    await page.evaluate("document.fonts.ready.then(() => true)");
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await page.close().catch(() => undefined);
  }
}

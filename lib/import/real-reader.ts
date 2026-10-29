// The reader Smart import uses for photos and PDFs. Cheapest first, and each step runs only if
// the one before left required fields empty:
//   1. e-invoice QR (jsQR)     — local, fields are "sure"
//   2. PDF text + rules        — local, digital PDFs only
//   3. Gemini                  — one paid call, only with AI_READER=gemini and GEMINI_API_KEY
// Everything it returns is checked by finish-invoice.ts and still needs the user to review and Save.
// Excel / CSV go to the SheetJS reader (excel-reader.ts), with one optional Gemini call for columns
// it couldn't place.
import { mergeDraft, missingFields, type Draft, type DraftSources } from "./draft";
import { finishInvoice } from "./finish-invoice";
import { readExcel } from "./excel-reader";
import { readWithRetry } from "./gemini-step";
import { readWithGemini, geminiEnabled } from "./readers/gemini";
import { suggestColumnsWithGemini } from "./readers/gemini-columns";
import { compressForAi, rawPixels } from "./readers/image";
import { openPdf, type PdfFile } from "./readers/pdf";
import { scanPixels } from "./readers/qr";
import { parseInvoiceText } from "./text-parser";
import type { EInvoiceQr } from "./qr-payload";
import type { ImportReader, ReaderFile, ReadSource } from "./types";

/** QR codes on invoices are small and dense, so PDF pages are drawn large for the scan. */
const QR_SCALE = 4;
/** Pages looked at for a QR and for text; Gemini gets at most the first two. */
const QR_PAGES = 3;
const TEXT_PAGES = 5;
const GEMINI_PAGES = 2;
/** Less text than this on a PDF means a scan: skip the rules. */
const MIN_TEXT_CHARS = 60;

const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

const qrDraft = (q: EInvoiceQr): Draft => ({
  lines: [],
  sellerGstin: q.sellerGstin,
  buyerGstin: q.buyerGstin,
  invoiceNo: q.docNo,
  ...(q.docDate && { invoiceDate: q.docDate }),
  ...(q.totalPaise !== null && { totalPaise: q.totalPaise }),
  ...(q.itemCount !== null && { itemCount: q.itemCount }),
  ...(q.mainHsn && { mainHsn: q.mainHsn }),
  ...(q.irn && { irn: q.irn }),
  qrPayload: q.raw,
});

/** Runs a step that may fail on a bad file; a failed step is skipped, not fatal. */
async function attempt<T>(step: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    console.warn(`[import] ${step} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function findQr(file: ReaderFile, pdf: PdfFile | null): Promise<EInvoiceQr | null> {
  if (!pdf) {
    // A photo: try a large and then a smaller copy (the smaller one decodes blurry shots better).
    for (const side of [2800, 1400]) {
      const hit = scanPixels(await rawPixels(file.bytes, side));
      if (hit) return hit;
    }
    return null;
  }
  for (let n = 1; n <= Math.min(QR_PAGES, pdf.pages); n++) {
    const hit = scanPixels(await pdf.render(n, QR_SCALE));
    if (hit) return hit;
  }
  return null;
}

async function readDocument(file: ReaderFile) {
  const pdf = isPdf(file.bytes) ? await openPdf(file.bytes) : null;
  try {
    let draft: Draft = { lines: [] };
    let sources: DraftSources = {};
    const readBy: ReadSource[] = [];
    const take = (extra: Draft, source: ReadSource) => {
      const merged = mergeDraft(draft, sources, extra, source);
      const added = Object.values(merged.sources).filter((s) => s === source).length;
      draft = merged.draft;
      sources = merged.sources;
      if (added > 0) readBy.push(source);
    };

    // 1. QR
    const qr = await attempt("qr scan", () => findQr(file, pdf));
    if (qr) take(qrDraft(qr), "qr");

    // 2. PDF text
    if (pdf && missingFields(draft).length) {
      const text = await attempt("pdf text", () => pdf.text(TEXT_PAGES));
      if (text && text.replace(/\s/g, "").length >= MIN_TEXT_CHARS) {
        take(parseInvoiceText(text), "pdf_text");
      }
    }

    // 3. Gemini, only if something required is still empty: flash-lite first, and gemini-2.5-flash
    //    once more if the answer fails our checks (GSTIN checksum, totals)
    if (missingFields(draft).length && geminiEnabled()) {
      const step = await attempt("gemini", async () => {
        const pictures = pdf
          ? await Promise.all(
              Array.from({ length: Math.min(GEMINI_PAGES, pdf.pages) }, async (_, i) =>
                compressForAi(await pdf.renderPng(i + 1, 2)),
              ),
            )
          : [await compressForAi(file.bytes)];
        return readWithRetry(draft, sources, (model) => readWithGemini(pictures, model));
      });
      if (step) {
        draft = step.draft;
        sources = step.sources;
        if (step.used) readBy.push("gemini");
      }
    }

    return finishInvoice(draft, sources, readBy, pdf?.pages ?? 1);
  } finally {
    await pdf?.close();
  }
}

export const realReader: ImportReader = {
  readExcel: (file, hints) =>
    readExcel(file, {
      ...hints,
      suggestColumns: geminiEnabled() ? suggestColumnsWithGemini : undefined,
    }),
  readDocument,
};

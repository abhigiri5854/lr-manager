// The reader Smart import uses for photos and PDFs. Cheapest first, and each step runs only if
// the one before left required fields empty:
//   1. e-invoice QR (jsQR)     — local, fields are "sure"
//   2. PDF text + rules        — local, digital PDFs only
//   3. Gemini                  — one paid call, only with AI_READER=gemini and GEMINI_API_KEY
// Everything it returns is checked by finish-invoice.ts and still needs the user to review and Save.
// Excel / CSV go to the SheetJS reader (excel-reader.ts), with one optional Gemini call for columns
// it couldn't place.
import { mergeDraft, missingFields, type Draft, type DraftSources } from "./draft";
import { distinctPages } from "./copies";
import { finishInvoice } from "./finish-invoice";
import { readExcel } from "./excel-reader";
import { readWithRetry } from "./gemini-step";
import { readWithGemini, geminiEnabled, groundedInText } from "./readers/gemini";
import { suggestColumnsWithGemini } from "./readers/gemini-columns";
import { compressForAi, rawPixels } from "./readers/image";
import { openPdf, type PdfFile } from "./readers/pdf";
import { scanPixels } from "./readers/qr";
import { parseInvoiceText } from "./text-parser";
import type { EInvoiceQr } from "./qr-payload";
import type { DocumentHints, ImportReader, ReaderFile, ReadSource } from "./types";

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
async function attempt<T>(
  step: string,
  run: () => Promise<T>,
  errors?: string[],
): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[import] ${step} failed:`, message);
    errors?.push(`${step}: ${message}`);
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

async function readDocument(file: ReaderFile, hints?: DocumentHints) {
  const pdf = isPdf(file.bytes) ? await openPdf(file.bytes) : null;
  try {
    let draft: Draft = { lines: [] };
    let sources: DraftSources = {};
    const readBy: ReadSource[] = [];
    const errors: string[] = [];
    const take = (extra: Draft, source: ReadSource) => {
      const merged = mergeDraft(draft, sources, extra, source);
      const added = Object.values(merged.sources).filter((s) => s === source).length;
      draft = merged.draft;
      sources = merged.sources;
      if (added > 0) readBy.push(source);
    };

    // 1. QR
    const qr = await attempt("qr scan", () => findQr(file, pdf), errors);
    if (qr) take(qrDraft(qr), "qr");

    // 2. PDF text. Original/Duplicate/Triplicate copies of a page are one invoice: read the first.
    let pdfText: string | null = null;
    let pageNos = pdf ? Array.from({ length: pdf.pages }, (_, i) => i + 1) : [];
    if (pdf) {
      const texts = await attempt("pdf text", () => pdf.pageTexts(TEXT_PAGES), errors);
      if (texts) {
        const keep = distinctPages(texts);
        pageNos = [...keep, ...pageNos.filter((n) => n > texts.length)];
        const text = keep.map((n) => texts[n - 1]).join("\n");
        if (missingFields(draft).length && text.replace(/\s/g, "").length >= MIN_TEXT_CHARS) {
          pdfText = text;
          take(parseInvoiceText(text), "pdf_text");
        }
      }
    }

    // 3. Gemini, only if something required is still empty: flash-lite first, and gemini-3.5-flash
    //    once more if the answer fails our checks (GSTIN checksum, totals)
    if (missingFields(draft).length && geminiEnabled()) {
      const step = await attempt(
        "gemini",
        async () => {
          const pictures = pdf
            ? await Promise.all(
                pageNos
                  .slice(0, GEMINI_PAGES)
                  .map(async (n) => compressForAi(await pdf.renderPng(n, 2))),
              )
            : [await compressForAi(file.bytes)];
          // This seller's recent corrections (seller known from the QR / PDF text) go in as hints.
          const corrections =
            draft.sellerGstin && hints?.correctionsFor
              ? ((await attempt(
                  "corrections",
                  () => hints.correctionsFor!(draft.sellerGstin!, 10),
                  errors,
                )) ?? [])
              : [];
          return readWithRetry(draft, sources, async (model) => {
            const d = await readWithGemini(pictures, model, corrections);
            return d && groundedInText(d, pdfText);
          });
        },
        errors,
      );
      if (step) {
        draft = step.draft;
        sources = step.sources;
        if (step.used) readBy.push("gemini");
      }
    }

    const result = finishInvoice(draft, sources, readBy, pdf ? pageNos.length : 1);
    // Nothing read and a step threw: show the real error instead of "couldn't read an invoice".
    if (result.documentType === "unknown" && errors.length) throw new Error(errors.join("; "));
    return result;
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

// PDF access for the real reader: the text layer of a digital PDF and page renders (for the QR
// scan and, only when needed, for Gemini). pdfjs-dist and @napi-rs/canvas are server externals
// (next.config.ts) and are loaded on first use so pages that never import files don't pay for them.
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

export type PdfFile = {
  pages: number;
  /** Text of the first `maxPages` pages, one line per visual row. Empty for a scan. */
  text(maxPages: number): Promise<string>;
  /** Page `n` (1-based) as raw RGBA pixels at `scale` × the PDF's own size. */
  render(n: number, scale: number): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }>;
  /** Same render as a PNG. */
  renderPng(n: number, scale: number): Promise<Uint8Array>;
  close(): Promise<void>;
};

type TextRun = { str?: string; transform?: number[]; hasEOL?: boolean };

export async function openPdf(bytes: Uint8Array): Promise<PdfFile> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const doc: PDFDocumentProxy = await pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  async function renderToCanvas(n: number, scale: number) {
    const { createCanvas } = await import("@napi-rs/canvas");
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // The canvas types of the two packages differ; pdf.js only draws on it.
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
    }).promise;
    return { canvas, ctx };
  }

  return {
    pages: doc.numPages,

    async text(maxPages) {
      const out: string[] = [];
      for (let n = 1; n <= Math.min(maxPages, doc.numPages); n++) {
        const content = await (await doc.getPage(n)).getTextContent();
        // Group runs into rows by their y position (within 2 units), left to right.
        const rows = new Map<number, { x: number; s: string }[]>();
        for (const run of content.items as TextRun[]) {
          if (!run.str?.trim() || !run.transform) continue;
          const y = Math.round(run.transform[5] / 2) * 2;
          const row = rows.get(y) ?? [];
          row.push({ x: run.transform[4], s: run.str });
          rows.set(y, row);
        }
        [...rows.entries()]
          .sort((a, b) => b[0] - a[0])
          .forEach(([, row]) => out.push(row.sort((a, b) => a.x - b.x).map((r) => r.s).join(" ")));
      }
      return out.join("\n");
    },

    async render(n, scale) {
      const { canvas, ctx } = await renderToCanvas(n, scale);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return { width: canvas.width, height: canvas.height, rgba: new Uint8ClampedArray(img.data) };
    },

    async renderPng(n, scale) {
      const { canvas } = await renderToCanvas(n, scale);
      return new Uint8Array(canvas.toBuffer("image/png"));
    },

    close: () => doc.destroy(),
  };
}

import { mockReader } from "./mock-reader";
import type { ImportReader } from "./types";

/** Loads the real reader (SheetJS, sharp, pdf.js, Gemini SDK) on first use, so unit tests and pages that never read files skip it. */
const lazyReal: ImportReader = {
  readExcel: async (file, hints) => (await import("./real-reader")).realReader.readExcel(file, hints),
  readDocument: async (file, hints) =>
    (await import("./real-reader")).realReader.readDocument(file, hints),
};

/**
 * The reader Smart import uses: the real one (invoices: QR → PDF text → Gemini) everywhere except unit
 * tests, where DATA_SOURCE=mock under Vitest keeps the fixed samples. Excel / CSV go through
 * SheetJS (no AI; one Gemini call only for columns it can't place).
 */
export function getReader(): ImportReader {
  return process.env.VITEST && process.env.DATA_SOURCE === "mock" ? mockReader : lazyReal;
}

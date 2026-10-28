import { mockReader } from "./mock-reader";
import type { ImportReader } from "./types";

/**
 * The reader Smart import uses. Replace the mock with the SheetJS reader (Excel / CSV) and the
 * Anthropic reader (photos / PDFs) when they exist — nothing else needs to change.
 */
export function getReader(): ImportReader {
  return mockReader;
}

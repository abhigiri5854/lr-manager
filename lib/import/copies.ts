// Indian GST invoices are often printed as several copies of the same page ("Original for
// Recipient", "Duplicate for Transporter", "Triplicate for Supplier"). They are one invoice, so
// only the first copy is read. Pure: works on each page's text layer.

const COPY_LABEL =
  /\b(?:original|duplicate|triplicate|quadruplicate|extra|office)\s+(?:copy\s+)?(?:for|of)?\s*(?:the\s+)?(?:recipient|buyer|consignee|transporter|supplier|seller|consignor|assessee|driver|office)?\b/gi;

import { findInvoiceNo } from "./text-parser";

/** A page that says it is a copy: "Original for Recipient", "Duplicate", "(Triplicate)". */
const COPY_MARK = /\b(?:original|duplicate|triplicate|quadruplicate)\b/i;

const fingerprint = (text: string) =>
  text
    .replace(COPY_LABEL, " ")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/**
 * @param pageTexts text of each page, in order
 * @returns 1-based numbers of the pages to read: every page except a copy of an earlier page.
 *   Pages with no text (scans) are always kept.
 */
export function distinctPages(pageTexts: string[]): number[] {
  const seen = new Set<string>();
  const copiedNos = new Set<string>();
  const keep: number[] = [];
  pageTexts.forEach((t, i) => {
    const fp = fingerprint(t);
    if (fp.length < 40) return void keep.push(i + 1);
    // Same invoice number on a page marked Original/Duplicate/Triplicate = another copy of one invoice.
    const no = findInvoiceNo(t);
    if (no && COPY_MARK.test(t.slice(0, 1000))) {
      if (copiedNos.has(no)) return;
      copiedNos.add(no);
    }
    if (seen.has(fp)) return;
    seen.add(fp);
    keep.push(i + 1);
  });
  return keep;
}

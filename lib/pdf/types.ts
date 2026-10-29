import type { CompanySnapshot } from "@/lib/types";

/** Company details as printed: the stored snapshot (or live profile for drafts) plus its images inlined. */
export type PdfCompany = CompanySnapshot & {
  /** data: URI of the logo, null when the company has none (or it can't be read). */
  logoSrc: string | null;
  signatureSrc: string | null;
};

/** Big diagonal word printed behind every page of a document that isn't final. */
export type PdfMark = "DRAFT" | "CANCELLED" | null;

/** A rendered document: what the route turns into a PDF. */
export type PdfDoc = { html: string; filename: string };

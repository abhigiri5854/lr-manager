// One builder per document: load the data, fill the template, name the file.
import { loadBillPdf, loadInvoicePdf, loadLrPdf, loadPodPdf } from "./load";
import { billHtml } from "./templates/bill";
import { invoiceHtml } from "./templates/invoice";
import { lrHtml } from "./templates/lr";
import { podHtml } from "./templates/pod";
import { fileSafe } from "./templates/shared";
import type { PdfDoc } from "./types";

export type PdfBuilder = (companyId: string, id: string) => Promise<PdfDoc | null>;

/** /pdf/lr/[id] → LR-19021.pdf (all copies). */
export const lrPdf: PdfBuilder = async (companyId, id) => {
  const d = await loadLrPdf(companyId, id);
  return d && { html: lrHtml(d), filename: `LR-${fileSafe(d.lr.lrNo)}.pdf` };
};

/** /pdf/invoice/[id] → INV-<no>.pdf */
export const invoicePdf: PdfBuilder = async (companyId, id) => {
  const d = await loadInvoicePdf(companyId, id);
  return (
    d && {
      html: invoiceHtml(d),
      filename: `INV-${fileSafe(d.invoice.invoiceNo ?? "draft")}.pdf`,
    }
  );
};

/** /pdf/pod/[id] (the POD's id) → POD-<lrno>.pdf */
export const podPdf: PdfBuilder = async (companyId, id) => {
  const d = await loadPodPdf(companyId, id);
  return d && { html: podHtml(d), filename: `POD-${fileSafe(d.lr.lrNo)}.pdf` };
};

/** /pdf/bill/[id] → FB-<no>.pdf */
export const billPdf: PdfBuilder = async (companyId, id) => {
  const d = await loadBillPdf(companyId, id);
  return d && { html: billHtml(d), filename: `FB-${fileSafe(d.bill.billNo ?? "draft")}.pdf` };
};

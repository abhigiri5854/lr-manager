import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { InvoiceFormSkeleton } from "@/components/invoices/InvoiceFormSkeleton";
import { getTaxInvoiceById } from "@/lib/data/invoices";
import { getActiveCompanyId } from "@/lib/data/session";
import { invoiceToFormValues } from "@/lib/invoice-form";
import { isImportedInvoice } from "@/lib/invoice-status";
import {
  invoiceMeta,
  loadCompanyInvoiceSettings,
  loadInvoicePicked,
  loadLinkedLrs,
  loadSeller,
} from "../load-form";

export const metadata: Metadata = { title: "Tax invoice" };

async function InvoiceLoader({ params }: Pick<PageProps<"/invoices/[id]">, "params">) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const inv = await getTaxInvoiceById(companyId, id);
  if (!inv) notFound();
  const [seller, picked, settings, linkedLrs] = await Promise.all([
    loadSeller(companyId, inv),
    loadInvoicePicked(companyId, inv),
    loadCompanyInvoiceSettings(companyId),
    loadLinkedLrs(companyId, inv.id),
  ]);
  return (
    <InvoiceForm
      // A save bumps the version; remounting picks up the saved values.
      key={`${inv.id}:${inv.version}`}
      invoice={invoiceMeta(inv, seller.state)}
      initial={invoiceToFormValues(inv, picked)}
      seller={seller}
      imported={isImportedInvoice(inv)}
      roundOff={settings.roundOff}
      nextInvoiceNo={settings.nextInvoiceNo}
      linkedLrs={linkedLrs}
    />
  );
}

export default function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  return (
    <Suspense fallback={<InvoiceFormSkeleton />}>
      <InvoiceLoader params={params} />
    </Suspense>
  );
}

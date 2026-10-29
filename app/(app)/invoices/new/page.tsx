import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { InvoiceFormSkeleton } from "@/components/invoices/InvoiceFormSkeleton";
import { getInvoiceImport } from "@/lib/data/import";
import { getPartyById } from "@/lib/data/parties";
import { getActiveCompanyId } from "@/lib/data/session";
import { emptyInvoiceForm } from "@/lib/invoice-form";
import { isoToIstInput } from "@/lib/lr-form";
import { loadCompanyInvoiceSettings, loadSeller } from "../load-form";

export const metadata: Metadata = { title: "New tax invoice" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * `?party=<id>` starts the invoice billed to that party.
 * `?import=<file>` (from Smart import) opens what was read from that file, ready to check and save.
 */
async function NewInvoice({ searchParams }: Pick<PageProps<"/invoices/new">, "searchParams">) {
  const params = await searchParams;
  const companyId = await getActiveCompanyId();
  const settings = await loadCompanyInvoiceSettings(companyId);

  const importId = one(params.import);
  if (importId) {
    const imp = await getInvoiceImport(companyId, importId);
    // The file was removed or already saved: back to the list of files.
    if (!imp) redirect("/import");
    return (
      <InvoiceForm
        invoice={null}
        initial={imp.prefill.initial}
        seller={imp.prefill.seller}
        imported
        roundOff={settings.roundOff}
        nextInvoiceNo={null}
        linkedLrs={[]}
        importInfo={{
          batchId: imp.batch.id,
          fileName: imp.batch.fileName,
          fileUrl: imp.batch.fileUrl,
          readBy: imp.batch.readBy,
          flags: imp.prefill.flags,
          pending: imp.prefill.pending,
          existing: imp.existing,
        }}
      />
    );
  }

  const [seller, party] = await Promise.all([
    loadSeller(companyId, null),
    one(params.party) ? getPartyById(companyId, one(params.party)!) : null,
  ]);
  const initial = emptyInvoiceForm(isoToIstInput(new Date().toISOString()));
  if (party && !party.cancelledAt) {
    initial.billTo = {
      id: party.id,
      name: party.name,
      place: party.place,
      gstin: party.gstin,
      phone: party.phone,
      address: party.address,
      stateCode: party.stateCode,
      isSelf: party.isSelf,
    };
  }
  return (
    <InvoiceForm
      invoice={null}
      initial={initial}
      seller={seller}
      imported={false}
      roundOff={settings.roundOff}
      nextInvoiceNo={settings.nextInvoiceNo}
      linkedLrs={[]}
    />
  );
}

export default function NewInvoicePage({ searchParams }: PageProps<"/invoices/new">) {
  return (
    <Suspense fallback={<InvoiceFormSkeleton />}>
      <NewInvoice searchParams={searchParams} />
    </Suspense>
  );
}

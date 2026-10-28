import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { InvoiceFormSkeleton } from "@/components/invoices/InvoiceFormSkeleton";
import { getPartyById } from "@/lib/data/parties";
import { getActiveCompanyId } from "@/lib/data/session";
import { emptyInvoiceForm } from "@/lib/invoice-form";
import { isoToIstInput } from "@/lib/lr-form";
import { loadCompanyInvoiceSettings, loadSeller } from "../load-form";

export const metadata: Metadata = { title: "New tax invoice" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** `?party=<id>` starts the invoice billed to that party. */
async function NewInvoice({ searchParams }: Pick<PageProps<"/invoices/new">, "searchParams">) {
  const params = await searchParams;
  const companyId = await getActiveCompanyId();
  const [seller, settings, party] = await Promise.all([
    loadSeller(companyId, null),
    loadCompanyInvoiceSettings(companyId),
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

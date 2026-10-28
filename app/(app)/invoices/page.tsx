import type { Metadata } from "next";
import { Suspense } from "react";
import { InvoiceList, InvoiceListSkeleton } from "@/components/invoices/InvoiceList";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { listTaxInvoices } from "@/lib/data/invoices";
import { listPartyOptions } from "@/lib/data/parties";
import { getActiveCompanyId } from "@/lib/data/session";
import { parseInvoiceListQuery } from "@/lib/validators/invoice-list";

export const metadata: Metadata = { title: "Tax invoices" };

const SUBTITLE =
  "Goods invoices you issue, and consignors' invoices read from photos. Drafts get a number on Finalise.";

/** Per request: reads the URL and the active company. */
async function InvoiceListLoader({ searchParams }: Pick<PageProps<"/invoices">, "searchParams">) {
  const query = parseInvoiceListQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const [page, parties] = await Promise.all([
    listTaxInvoices(companyId, {
      search: query.q,
      status: query.status,
      from: query.from,
      to: query.to,
      partyId: query.party,
      page: query.page,
    }),
    listPartyOptions(companyId),
  ]);
  return <InvoiceList query={query} page={page} parties={parties} />;
}

export default function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  return (
    <>
      <PageHeader
        title="Tax invoices"
        subtitle={SUBTITLE}
        actions={<Button href="/invoices/new">+ New invoice</Button>}
      />
      <Suspense fallback={<InvoiceListSkeleton />}>
        <InvoiceListLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

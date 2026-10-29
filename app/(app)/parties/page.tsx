import type { Metadata } from "next";
import { Suspense } from "react";
import { AddPartyButton } from "@/components/parties/AddPartyButton";
import { PartyList, PartyListSkeleton } from "@/components/parties/PartyList";
import { PageHeader } from "@/components/ui/PageHeader";
import { listPartyRows } from "@/lib/data/parties";
import { getActiveCompanyId } from "@/lib/data/session";
import { parsePartyListQuery } from "@/lib/validators/party-list";

export const metadata: Metadata = { title: "Parties" };

/** Per request: reads the URL and the active company. */
async function PartyListLoader({ searchParams }: Pick<PageProps<"/parties">, "searchParams">) {
  const query = parsePartyListQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const page = await listPartyRows(companyId, { search: query.q, page: query.page });
  return <PartyList query={query} page={page} />;
}

export default function PartiesPage({ searchParams }: PageProps<"/parties">) {
  return (
    <>
      <PageHeader
        title="Parties"
        subtitle="Consignors, consignees and billing parties. Saved details fill every new LR and invoice."
        actions={<AddPartyButton />}
      />
      <Suspense fallback={<PartyListSkeleton />}>
        <PartyListLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

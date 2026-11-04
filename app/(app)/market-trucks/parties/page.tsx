import type { Metadata } from "next";
import { Suspense } from "react";
import { AddTruckPartyButton } from "@/components/market-trucks/AddTruckPartyButton";
import {
  TruckPartyList,
  TruckPartyListSkeleton,
} from "@/components/market-trucks/TruckPartyList";
import { PageHeader } from "@/components/ui/PageHeader";
import { getActiveCompanyId } from "@/lib/data/session";
import { listTruckPartyRows } from "@/lib/data/truck-parties";
import { parseTruckPartyListQuery } from "@/lib/validators/truck-party-list";

export const metadata: Metadata = { title: "Truck parties" };

/** Per request: reads the URL and the active company. */
async function ListLoader({ searchParams }: Pick<PageProps<"/market-trucks/parties">, "searchParams">) {
  const query = parseTruckPartyListQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const page = await listTruckPartyRows(companyId, { search: query.q, page: query.page });
  return <TruckPartyList query={query} page={page} />;
}

export default function TruckPartiesPage({ searchParams }: PageProps<"/market-trucks/parties">) {
  return (
    <>
      <PageHeader
        title="Truck parties"
        subtitle="Market-truck owners and brokers you pay lorry hire to: bank, UPI, TDS declarations and verification."
        actions={<AddTruckPartyButton />}
      />
      <Suspense fallback={<TruckPartyListSkeleton />}>
        <ListLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

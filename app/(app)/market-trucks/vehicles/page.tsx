import type { Metadata } from "next";
import { Suspense } from "react";
import { AddMarketVehicleButton } from "@/components/market-trucks/AddMarketVehicleButton";
import {
  MarketVehicleList,
  MarketVehicleListSkeleton,
} from "@/components/market-trucks/MarketVehicleList";
import { PageHeader } from "@/components/ui/PageHeader";
import { listMarketVehicleRows } from "@/lib/data/market-vehicles";
import { getActiveCompanyId } from "@/lib/data/session";
import { parseMarketListQuery } from "@/lib/validators/market-list";

export const metadata: Metadata = { title: "Market vehicles" };

/** Per request: reads the URL and the active company. */
async function ListLoader({ searchParams }: Pick<PageProps<"/market-trucks/vehicles">, "searchParams">) {
  const query = parseMarketListQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const page = await listMarketVehicleRows(companyId, { search: query.q, page: query.page });
  return <MarketVehicleList query={query} page={page} />;
}

export default function MarketVehiclesPage({ searchParams }: PageProps<"/market-trucks/vehicles">) {
  return (
    <>
      <PageHeader
        title="Market vehicles"
        subtitle="Hired trucks with their owner, RC and insurance, fitness, permit and PUC dates. Expired dates show in red."
        actions={<AddMarketVehicleButton />}
      />
      <Suspense fallback={<MarketVehicleListSkeleton />}>
        <ListLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

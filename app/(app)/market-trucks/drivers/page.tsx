import type { Metadata } from "next";
import { Suspense } from "react";
import { AddMarketDriverButton } from "@/components/market-trucks/AddMarketDriverButton";
import {
  MarketDriverList,
  MarketDriverListSkeleton,
} from "@/components/market-trucks/MarketDriverList";
import { PageHeader } from "@/components/ui/PageHeader";
import { listMarketDriverRows } from "@/lib/data/market-drivers";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { can } from "@/lib/permissions";
import { parseMarketListQuery } from "@/lib/validators/market-list";

export const metadata: Metadata = { title: "Market drivers" };

/** Per request: reads the URL and the active company. */
async function ListLoader({ searchParams }: Pick<PageProps<"/market-trucks/drivers">, "searchParams">) {
  const query = parseMarketListQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const page = await listMarketDriverRows(companyId, { search: query.q, page: query.page });
  const role = await getActiveRole();
  return <MarketDriverList query={query} page={page} canEdit={can(role, "master.edit")} />;
}

export default function MarketDriversPage({ searchParams }: PageProps<"/market-trucks/drivers">) {
  return (
    <>
      <PageHeader
        title="Market drivers"
        subtitle="Drivers on hired trucks: mobile, licence number and licence expiry. Expired dates show in red."
        actions={<AddMarketDriverButton />}
      />
      <Suspense fallback={<MarketDriverListSkeleton />}>
        <ListLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

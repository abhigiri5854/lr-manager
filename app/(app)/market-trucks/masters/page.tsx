import type { Metadata } from "next";
import { Suspense } from "react";
import {
  BranchesTab,
  ChargeTypesTab,
  MasterTabNav,
  parseMasterTab,
  PumpsTab,
  SeriesTab,
  VehicleTypesTab,
} from "@/components/market-trucks/HireMasterTabs";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  listBranches,
  listChargeTypes,
  listHireSeries,
  listPumps,
  listVehicleTypes,
} from "@/lib/data/hire-masters";
import { getActiveCompanyId } from "@/lib/data/session";

export const metadata: Metadata = { title: "Hire masters" };

/** Per request: reads the tab from the URL and the active company. */
async function TabLoader({ searchParams }: Pick<PageProps<"/market-trucks/masters">, "searchParams">) {
  const tab = parseMasterTab((await searchParams).tab);
  const companyId = await getActiveCompanyId();
  return (
    <>
      <MasterTabNav active={tab} />
      {tab === "vehicle-types" && <VehicleTypesTab rows={await listVehicleTypes(companyId)} />}
      {tab === "charge-types" && <ChargeTypesTab rows={await listChargeTypes(companyId)} />}
      {tab === "pumps" && <PumpsTab rows={await listPumps(companyId)} />}
      {tab === "branches" && <BranchesTab rows={await listBranches(companyId)} />}
      {tab === "series" && <SeriesTabLoader companyId={companyId} />}
    </>
  );
}

async function SeriesTabLoader({ companyId }: { companyId: string }) {
  const [rows, branches] = await Promise.all([listHireSeries(companyId), listBranches(companyId)]);
  return <SeriesTab rows={rows} branches={branches} />;
}

export default function HireMastersPage({ searchParams }: PageProps<"/market-trucks/masters">) {
  return (
    <>
      <PageHeader
        title="Hire masters"
        subtitle="Vehicle types, charge types, pumps, branches and challan / payment number series."
      />
      <Suspense fallback={<MasterTabNav active="vehicle-types" />}>
        <TabLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

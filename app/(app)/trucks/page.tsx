import type { Metadata } from "next";
import { Suspense } from "react";
import { AddButtons } from "@/components/trucks/AddButtons";
import { TrucksScreen } from "@/components/trucks/TrucksScreen";
import { PageHeader } from "@/components/ui/PageHeader";
import { getActiveCompanyId } from "@/lib/data/session";
import { listDriverOptions, listDriverRows, listTruckRows } from "@/lib/data/trucks";
import { parseTruckListQuery } from "@/lib/validators/truck-list";

export const metadata: Metadata = { title: "Trucks & drivers" };

const SUBTITLE =
  "Every truck typed in an LR, scanned from an invoice or imported from Excel lands here once — no duplicates.";

/** Per request: reads the URL and the active company. */
async function TrucksLoader({ searchParams }: Pick<PageProps<"/trucks">, "searchParams">) {
  const query = parseTruckListQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const [trucks, drivers, driverOptions] = await Promise.all([
    listTruckRows(companyId, { search: query.q, page: query.tp }),
    listDriverRows(companyId, { search: query.q, page: query.dp }),
    listDriverOptions(companyId),
  ]);
  return (
    <TrucksScreen
      query={query}
      trucks={trucks}
      drivers={drivers}
      driverOptions={driverOptions}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}

async function AddButtonsLoader() {
  const companyId = await getActiveCompanyId();
  return <AddButtons driverOptions={await listDriverOptions(companyId)} />;
}

export default function TrucksPage({ searchParams }: PageProps<"/trucks">) {
  return (
    <>
      <PageHeader
        title="Trucks & drivers"
        subtitle={SUBTITLE}
        actions={
          <Suspense fallback={null}>
            <AddButtonsLoader />
          </Suspense>
        }
      />
      <Suspense fallback={<TrucksLoading />}>
        <TrucksLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function TrucksLoading() {
  return <TrucksScreen query={{ tp: 1, dp: 1 }} today="1970-01-01" loading />;
}

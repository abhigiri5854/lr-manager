import type { Metadata } from "next";
import { Suspense } from "react";
import { EwayRegister } from "@/components/market-trucks/EwayRegister";
import { EwbTasks } from "@/components/market-trucks/EwbTasks";
import { Button } from "@/components/ui/Button";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { getEwbRegister, getOpenEwbTasks } from "@/lib/data/ewb";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { can } from "@/lib/permissions";
import { ewbListSearch, parseEwbListQuery } from "@/lib/validators/ewb-list";

export const metadata: Metadata = { title: "E-way bills" };

/** Per request: reads the URL, the active company and role. */
async function Loader({ searchParams }: Pick<PageProps<"/market-trucks/eway">, "searchParams">) {
  const role = await getActiveRole();
  if (!can(role, "freight.view")) {
    return (
      <NoAccess
        title="E-way bills"
        role={role}
        action="freight.view"
        back={{ href: "/", label: "Back to the dashboard" }}
      />
    );
  }
  const query = parseEwbListQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const [page, tasks] = await Promise.all([
    getEwbRegister(companyId, query.when, query.page),
    getOpenEwbTasks(companyId),
  ]);
  return (
    <>
      <PageHeader
        title="E-way bills"
        subtitle="E-way bills on live challans, soonest expiry first. Expiry is the date entered, or computed from the generated date and distance."
        actions={
          <Button href={`/market-trucks/eway/export${ewbListSearch({ when: query.when })}`} download variant="secondary">
            Export Excel
          </Button>
        }
      />
      <EwbTasks tasks={tasks} canEdit={can(role, "master.edit")} showChallan />
      <EwayRegister query={query} page={page} />
    </>
  );
}

export default function EwayPage({ searchParams }: PageProps<"/market-trucks/eway">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Loader searchParams={searchParams} />
    </Suspense>
  );
}

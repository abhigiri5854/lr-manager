import type { Metadata } from "next";
import { Suspense } from "react";
import {
  ChallanRegister,
  ChallanRegisterSkeleton,
} from "@/components/market-trucks/ChallanRegister";
import { Button } from "@/components/ui/Button";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { listChallanRegister } from "@/lib/data/challans";
import { listBranches } from "@/lib/data/hire-masters";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { can } from "@/lib/permissions";
import { challanListSearch, parseChallanListQuery } from "@/lib/validators/challan-list";

export const metadata: Metadata = { title: "Challans" };

/** Per request: reads the URL, the active company and role. */
async function Loader({ searchParams }: Pick<PageProps<"/market-trucks/challans">, "searchParams">) {
  const role = await getActiveRole();
  if (!can(role, "freight.view")) {
    return (
      <NoAccess
        title="Challans"
        role={role}
        action="freight.view"
        back={{ href: "/", label: "Back to the dashboard" }}
      />
    );
  }
  const query = parseChallanListQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const filters = { ...query, page: undefined };
  const [page, branches] = await Promise.all([
    listChallanRegister(companyId, filters, query.page),
    listBranches(companyId),
  ]);
  return (
    <>
      <PageHeader
        title="Challans"
        subtitle="Lorry hire challans for market trucks: hire, paid, balance and how long the POD has been pending."
        actions={
          <>
            <Button href={`/market-trucks/challans/export${challanListSearch({ ...filters })}`} download variant="secondary">
              Export Excel
            </Button>
            {can(role, "lr.edit") && <Button href="/market-trucks/challans/new">+ New challan</Button>}
          </>
        }
      />
      <ChallanRegister
        query={query}
        page={page}
        branches={branches.filter((b) => !b.cancelledAt).map((b) => ({ id: b.id, name: b.name }))}
      />
    </>
  );
}

export default function ChallansPage({ searchParams }: PageProps<"/market-trucks/challans">) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Challans" />
          <ChallanRegisterSkeleton />
        </>
      }
    >
      <Loader searchParams={searchParams} />
    </Suspense>
  );
}

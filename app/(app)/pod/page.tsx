import type { Metadata } from "next";
import { Suspense } from "react";
import { PodList, PodListSkeleton } from "@/components/pod/PodList";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCompany } from "@/lib/data/companies";
import { listInTransitForPod, listPodPendingPage } from "@/lib/data/pod";
import { getActiveCompanyId } from "@/lib/data/session";
import { parsePodListQuery } from "@/lib/validators/pod-list";

export const metadata: Metadata = { title: "POD & delivery" };

/** Per request: reads the URL and the active company. */
async function PodListLoader({ searchParams }: Pick<PageProps<"/pod">, "searchParams">) {
  const query = parsePodListQuery(await searchParams);
  const companyId = await getActiveCompanyId();
  const params = { search: query.q, page: query.page };
  if (query.tab === "transit") {
    const transit = await listInTransitForPod(companyId, params);
    return <PodList query={query} transit={transit} showPenalty={false} />;
  }
  const [pending, company] = await Promise.all([
    listPodPendingPage(companyId, { ...params, overdueOnly: query.overdue === "1" }),
    getCompany(companyId),
  ]);
  // No penalty rule → no "Penalty so far" column.
  return (
    <PodList query={query} pending={pending} showPenalty={Boolean(company?.podPenaltyPerDay)} />
  );
}

export default function PodPage({ searchParams }: PageProps<"/pod">) {
  return (
    <>
      <PageHeader
        title="POD & delivery"
        subtitle="Delivered LRs waiting for the signed copy, and LRs still on the road."
      />
      <Suspense fallback={<PodListSkeleton />}>
        <PodListLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

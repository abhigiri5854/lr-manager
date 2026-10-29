import type { Metadata } from "next";
import { Suspense } from "react";
import {
  DashboardAside,
  NeedsAttention,
  OneClickRepeat,
} from "@/components/dashboard/DashboardAside";
import {
  DashboardColumns,
  DashboardHeader,
  DashboardSkeleton,
} from "@/components/dashboard/DashboardFrame";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { RecentLrs } from "@/components/dashboard/RecentLrs";
import { getDashboard } from "@/lib/data/dashboard";
import { getActiveCompanyId } from "@/lib/data/session";
import { IfCan } from "@/components/ui/Permissions";
import { NotOnDatabase } from "@/components/ui/NotOnDatabase";
import { onDatabase } from "@/lib/data/source";

export const metadata: Metadata = { title: "Dashboard" };

/** Per-request: reads the active company from the session. */
async function DashboardData() {
  const data = await getDashboard(await getActiveCompanyId());
  return (
    <>
      <KpiCards data={data} />
      <DashboardColumns>
        <RecentLrs lrs={data.recentLrs} />
        <DashboardAside>
          <NeedsAttention items={data.attention} />
          <IfCan action="lr.edit">
            <OneClickRepeat routes={data.repeatRoutes} />
          </IfCan>
        </DashboardAside>
      </DashboardColumns>
    </>
  );
}

export default function DashboardPage() {
  return (
    <>
      <DashboardHeader />
      {/* Temporary (prompt 19a): the dashboard reads LRs, which are still on the mock store. */}
      {onDatabase() ? (
        <NotOnDatabase what="Dashboard" />
      ) : (
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardData />
        </Suspense>
      )}
    </>
  );
}

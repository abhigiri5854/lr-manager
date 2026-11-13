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
import { MarketTrucks } from "@/components/dashboard/MarketTrucks";
import { getDashboard } from "@/lib/data/dashboard";
import { getMarketDashboard } from "@/lib/data/market-dashboard";
import { getActiveCompanyId } from "@/lib/data/session";
import { IfCan } from "@/components/ui/Permissions";

export const metadata: Metadata = { title: "Dashboard" };

async function MarketTrucksRow() {
  return <MarketTrucks data={await getMarketDashboard(await getActiveCompanyId())} />;
}

/** Per-request: reads the active company from the session. */
async function DashboardData() {
  const data = await getDashboard(await getActiveCompanyId());
  return (
    <>
      <KpiCards data={data} />
      <Suspense fallback={null}>
        <MarketTrucksRow />
      </Suspense>
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
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardData />
      </Suspense>
    </>
  );
}

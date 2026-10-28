import type { Metadata } from "next";
import Form from "next/form";
import { Suspense, type ReactNode } from "react";
import {
  DashboardAside,
  DashboardAsideLoading,
  NeedsAttention,
  OneClickRepeat,
} from "@/components/dashboard/DashboardAside";
import { KpiCards, KpiCardsLoading } from "@/components/dashboard/KpiCards";
import { RecentLrs, RecentLrsLoading } from "@/components/dashboard/RecentLrs";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { getDashboard } from "@/lib/data/dashboard";
import { getActiveCompanyId } from "@/lib/data/session";

export const metadata: Metadata = { title: "Dashboard" };

/** Table on the left, attention + repeat on the right; wraps into one column when narrow. */
function Columns({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-6">{children}</div>;
}

/** Per-request: reads the active company from the session. */
async function DashboardData() {
  const data = await getDashboard(await getActiveCompanyId());
  return (
    <>
      <KpiCards data={data} />
      <Columns>
        <RecentLrs lrs={data.recentLrs} />
        <DashboardAside>
          <NeedsAttention items={data.attention} />
          <OneClickRepeat routes={data.repeatRoutes} />
        </DashboardAside>
      </Columns>
    </>
  );
}

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={
          <>
            {/* Searches the LR register (?q=). */}
            <Form action="/lr" role="search">
              <label htmlFor="dashboard-search" className="sr-only">
                Search
              </label>
              <input
                id="dashboard-search"
                name="q"
                type="search"
                placeholder="Search LR no, truck, party, invoice, e-way bill…"
                className="h-control w-[380px] max-w-[calc(100vw-64px)] rounded-control border border-border-input bg-surface px-3.5 text-sm text-text"
              />
            </Form>
            <Button href="/import" variant="outline">
              Smart import
            </Button>
            <Button href="/lr/new">+ New LR</Button>
          </>
        }
      />
      <Suspense
        fallback={
          <>
            <KpiCardsLoading />
            <Columns>
              <RecentLrsLoading />
              <DashboardAsideLoading />
            </Columns>
          </>
        }
      >
        <DashboardData />
      </Suspense>
    </>
  );
}

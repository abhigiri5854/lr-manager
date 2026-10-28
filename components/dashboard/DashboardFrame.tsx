import Form from "next/form";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardAsideLoading } from "./DashboardAside";
import { KpiCardsLoading } from "./KpiCards";
import { RecentLrsLoading } from "./RecentLrs";

/** Table on the left, attention + repeat on the right; wraps into one column when narrow. */
export function DashboardColumns({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-6">{children}</div>;
}

/** Static header (no data), shared by the page and its loading state. */
export function DashboardHeader() {
  return (
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
  );
}

/** Loading state for everything below the header. */
export function DashboardSkeleton() {
  return (
    <>
      <KpiCardsLoading />
      <DashboardColumns>
        <RecentLrsLoading />
        <DashboardAsideLoading />
      </DashboardColumns>
    </>
  );
}

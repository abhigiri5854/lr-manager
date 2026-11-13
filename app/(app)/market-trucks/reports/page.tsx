import type { Metadata } from "next";
import { Suspense } from "react";
import { HireReport, ReportTabs, type ReportData } from "@/components/market-trucks/HireReports";
import { HireReportFilters } from "@/components/market-trucks/HireReportFilters";
import { Button } from "@/components/ui/Button";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getReportOptions,
  listHireOutstanding,
  listLaneRates,
  listPodPending,
  listTdsRegister,
  listTripMargin,
} from "@/lib/data/hire-reports";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { can } from "@/lib/permissions";
import {
  fyOptions,
  parseReportQuery,
  REPORT_META,
  REPORT_TABS,
  reportSearch,
} from "@/lib/validators/hire-report";

export const metadata: Metadata = { title: "Reports" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Per request: reads the URL, the active company and role. */
async function Loader({ searchParams }: Props) {
  const role = await getActiveRole();
  const allowed = REPORT_TABS.filter((t) => can(role, REPORT_META[t].action));
  if (!allowed.length) {
    return (
      <NoAccess
        title="Reports"
        role={role}
        action="freight.view"
        back={{ href: "/", label: "Back to the dashboard" }}
      />
    );
  }
  const { page: pageNo, tab: asked, ...rest } = parseReportQuery(await searchParams);
  const tab = allowed.includes(asked) ? asked : allowed[0];
  const companyId = await getActiveCompanyId();
  const fys = fyOptions(new Date().toISOString().slice(0, 10));
  const filters = tab === "tds" ? { ...rest, fy: rest.fy ?? fys[0] } : rest;
  const params = { page: pageNo };

  const [options, data] = await Promise.all([
    getReportOptions(companyId),
    (async (): Promise<ReportData> => {
      switch (tab) {
        case "hire":
          return { tab, page: await listHireOutstanding(companyId, filters, params) };
        case "pod":
          return { tab, page: await listPodPending(companyId, filters, params) };
        case "tds":
          return { tab, page: await listTdsRegister(companyId, filters, params) };
        case "margin":
          return { tab, page: await listTripMargin(companyId, filters, params) };
        case "lanes":
          return { tab, page: await listLaneRates(companyId, filters, params) };
      }
    })(),
  ]);

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Market-truck hire: outstanding, POD ageing, TDS, trip margin and lane rates."
        actions={
          <Button
            href={`/market-trucks/reports/export${reportSearch(tab, filters)}`}
            download
            variant="secondary"
          >
            Export Excel
          </Button>
        }
      />
      <div className="flex flex-col gap-5">
        <ReportTabs tabs={allowed.map((t) => ({ tab: t, label: REPORT_META[t].label }))} active={tab} />
        <HireReportFilters
          key={reportSearch(tab, filters)}
          tab={tab}
          filters={filters}
          branches={options.branches}
          vehicleTypes={options.vehicleTypes}
          fys={fys}
        />
        <HireReport data={data} filters={filters} />
      </div>
    </>
  );
}

export default function ReportsPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<PageHeader title="Reports" />}>
      <Loader searchParams={searchParams} />
    </Suspense>
  );
}

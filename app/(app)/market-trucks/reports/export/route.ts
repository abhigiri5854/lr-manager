import type { NextRequest } from "next/server";
import {
  listHireOutstanding,
  listLaneRates,
  listPodPending,
  listTdsRegister,
  listTripMargin,
} from "@/lib/data/hire-reports";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import {
  hireSheet,
  laneSheet,
  marginSheet,
  podSheet,
  reportWorkbook,
  tdsSheet,
} from "@/lib/export/hire-report-xlsx";
import { can } from "@/lib/permissions";
import { fyOptions, parseReportQuery, REPORT_META } from "@/lib/validators/hire-report";

/** GET /market-trucks/reports/export?tab=…&filters… → .xlsx of every filtered row (max 5,000) of that report. */
export async function GET(request: NextRequest) {
  const { tab, page: _page, ...filters } = parseReportQuery(new URL(request.url).searchParams);
  void _page;
  const role = await getActiveRole();
  if (!can(role, REPORT_META[tab].action)) {
    return new Response("Your role can't open this report.", { status: 403 });
  }
  const companyId = await getActiveCompanyId();
  const today = new Date().toISOString().slice(0, 10);
  const all = { all: true };
  const f = tab === "tds" ? { ...filters, fy: filters.fy ?? fyOptions(today)[0] } : filters;

  const sheet =
    tab === "hire"
      ? hireSheet(await listHireOutstanding(companyId, f, all))
      : tab === "pod"
        ? podSheet(await listPodPending(companyId, f, all))
        : tab === "tds"
          ? tdsSheet(await listTdsRegister(companyId, f, all))
          : tab === "margin"
            ? marginSheet(await listTripMargin(companyId, f, all))
            : laneSheet(await listLaneRates(companyId, f, all));

  return new Response(Buffer.from(reportWorkbook(sheet)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="hire-report-${tab}-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

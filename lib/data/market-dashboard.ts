import { can } from "@/lib/permissions";
import type { ReportFilters } from "@/lib/validators/hire-report";
import * as db from "./db/market-dashboard";
import { listHireOutstanding, listPodPending, listTripMargin } from "./hire-reports";
import { getActiveRole } from "./session";

// Dashboard "Market trucks" row. Each box is loaded only if the user has its permission (else null);
// the reads reuse the report functions, so the numbers match the reports exactly.

const EXPIRY_DAYS = 15;

/** First and last day of the current month in India, yyyy-mm-dd. */
function thisMonthIst() {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
}

const NONE = { page: 1 } as const;

export async function getMarketDashboard(companyId: string) {
  const role = await getActiveRole();
  const view = can(role, "freight.view");
  const bill = can(role, "bill.edit");
  const approve = can(role, "payment.approve");
  const month = thisMonthIst();
  const [outstanding, pod, expiring, margin, moving, pending, ewb] = await Promise.all([
    view ? listHireOutstanding(companyId, { positive: true } as ReportFilters, NONE) : null,
    view ? listPodPending(companyId, {} as ReportFilters, NONE) : null,
    view ? db.getExpiringDocs(companyId, EXPIRY_DAYS) : null,
    bill ? listTripMargin(companyId, { ...month } as ReportFilters, NONE) : null,
    view ? db.getTrucksOnTheMove(companyId) : null,
    approve ? db.countPaymentsAwaitingApproval(companyId) : null,
    view ? db.getEwbSummary(companyId) : null,
  ]);
  return {
    outstanding: outstanding && {
      balancePaise: outstanding.totals.balancePaise,
      parties: outstanding.total,
    },
    pod: pod && pod.totals,
    expiring,
    margin: margin && {
      lowCount: margin.totals.lowCount,
      marginPaise: margin.totals.marginPaise,
    },
    moving,
    pendingPayments: pending,
    ewb,
  };
}

export type MarketDashboard = Awaited<ReturnType<typeof getMarketDashboard>>;

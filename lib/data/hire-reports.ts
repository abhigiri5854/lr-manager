import type { ReportFilters } from "@/lib/validators/hire-report";
import * as db from "./db/hire-reports";
import { assertCan } from "./session";

// Hire reports exist on the database only. Reading is freight.view; the TDS register and trip margin
// need bill.edit (margin is never shown to freight.view-only roles). RLS enforces freight.view too.

type Params = { page?: number; all?: boolean };

export const getReportOptions = (companyId: string) => db.getReportOptions(companyId);

export async function listHireOutstanding(companyId: string, f: ReportFilters, p: Params) {
  await assertCan(companyId, "freight.view");
  return db.listHireOutstanding(companyId, f, p);
}
export async function listPodPending(companyId: string, f: ReportFilters, p: Params) {
  await assertCan(companyId, "freight.view");
  return db.listPodPending(companyId, f, p);
}
// Totals-only reads for the dashboard boxes (no rows query); same permission as the full lists.
export async function getHireOutstandingTotals(companyId: string, f: ReportFilters) {
  await assertCan(companyId, "freight.view");
  return db.getHireOutstandingTotals(companyId, f);
}
export async function getPodPendingTotals(companyId: string, f: ReportFilters) {
  await assertCan(companyId, "freight.view");
  return db.getPodPendingTotals(companyId, f);
}
export async function getTripMarginTotals(companyId: string, f: ReportFilters) {
  await assertCan(companyId, "bill.edit");
  return db.getTripMarginTotals(companyId, f);
}
export async function listTdsRegister(companyId: string, f: ReportFilters, p: Params) {
  await assertCan(companyId, "bill.edit");
  return db.listTdsRegister(companyId, f, p);
}
export async function listTripMargin(companyId: string, f: ReportFilters, p: Params) {
  await assertCan(companyId, "bill.edit");
  return db.listTripMargin(companyId, f, p);
}
export async function listLaneRates(companyId: string, f: ReportFilters, p: Params) {
  await assertCan(companyId, "freight.view");
  return db.listLaneRates(companyId, f, p);
}

"use server";

// Server actions for the challan screen. Role checks happen in lib/data (lr.edit to save).
import type { ChallanInsightQuery, ChallanInsights } from "@/lib/challan-insights";
import { getChallanInsights, saveChallan, searchBrokers, searchChallanLrs } from "@/lib/data/challans";
import { listMarketDriverRows } from "@/lib/data/market-drivers";
import { listMarketVehicleRows, type MarketVehicleRow } from "@/lib/data/market-vehicles";
import { getActiveCompanyId } from "@/lib/data/session";
import type { ChallanLrPick, ChallanView, MarketDriver } from "@/lib/types";
import type { ChallanInput } from "@/lib/validators/challan";
import { toFailure, type ActionFailure } from "../failure";

export async function saveChallanAction(
  id: string | null,
  expectedVersion: number | null,
  input: ChallanInput,
): Promise<{ ok: true; challan: ChallanView } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    return { ok: true, challan: await saveChallan(companyId, id, expectedVersion, input) };
  } catch (e) {
    return toFailure(e);
  }
}

export async function challanInsightsAction(query: ChallanInsightQuery): Promise<ChallanInsights> {
  return getChallanInsights(await getActiveCompanyId(), query);
}

export async function searchChallanLrsAction(
  search: string,
  exceptChallanId: string | null,
): Promise<ChallanLrPick[]> {
  return searchChallanLrs(await getActiveCompanyId(), search, exceptChallanId);
}

export async function searchChallanVehiclesAction(search: string): Promise<MarketVehicleRow[]> {
  const page = await listMarketVehicleRows(await getActiveCompanyId(), { search, pageSize: 8 });
  return page.rows;
}

export async function searchChallanDriversAction(search: string): Promise<MarketDriver[]> {
  const page = await listMarketDriverRows(await getActiveCompanyId(), { search, pageSize: 8 });
  return page.rows;
}

export async function searchChallanBrokersAction(search: string) {
  return searchBrokers(await getActiveCompanyId(), search);
}

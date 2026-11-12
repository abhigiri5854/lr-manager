"use server";

// Server actions for the challan screen. Role checks happen in lib/data (lr.edit to save).
import { revalidatePath } from "next/cache";
import type { ChallanInsightQuery, ChallanInsights } from "@/lib/challan-insights";
import { getChallanInsights, saveChallan, searchBrokers, searchChallanLrs } from "@/lib/data/challans";
import {
  recordChallanPod,
  reopenChallan,
  saveChallanPodCharges,
  settleChallan,
} from "@/lib/data/challan-pod";
import { listMarketDriverRows } from "@/lib/data/market-drivers";
import { listMarketVehicleRows, type MarketVehicleRow } from "@/lib/data/market-vehicles";
import { getActiveCompanyId } from "@/lib/data/session";
import type {
  ChallanLrPick,
  ChallanSettlement,
  ChallanSettlementState,
  ChallanView,
  MarketDriver,
} from "@/lib/types";
import type { ChallanInput } from "@/lib/validators/challan";
import type {
  ChallanPodChargesInput,
  ChallanPodInput,
  ReopenChallanInput,
} from "@/lib/validators/challan-pod";
import { toFailure, type ActionFailure } from "../failure";

export async function saveChallanAction(
  id: string | null,
  expectedVersion: number | null,
  input: ChallanInput,
): Promise<{ ok: true; challan: ChallanView } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const challan = await saveChallan(companyId, id, expectedVersion, input);
    // Create / edit / dispatch all go through here: refresh the register and the challan page.
    revalidatePath("/market-trucks/challans");
    revalidatePath(`/market-trucks/challans/${challan.id}`);
    return { ok: true, challan };
  } catch (e) {
    return toFailure(e);
  }
}

// ---------- POD & settlement (role checks in lib/data/challan-pod) ----------
type SettlementResult = { ok: true; settlement: ChallanSettlement } | ActionFailure;
type StateResult = { ok: true; state: ChallanSettlementState } | ActionFailure;

function touched(id: string) {
  revalidatePath("/market-trucks/challans");
  revalidatePath(`/market-trucks/challans/${id}`);
}

export async function recordChallanPodAction(
  id: string,
  expectedVersion: number,
  input: ChallanPodInput,
): Promise<SettlementResult> {
  try {
    const settlement = await recordChallanPod(await getActiveCompanyId(), id, expectedVersion, input);
    touched(id);
    return { ok: true, settlement };
  } catch (e) {
    return toFailure(e);
  }
}

export async function saveChallanPodChargesAction(
  id: string,
  expectedVersion: number,
  input: ChallanPodChargesInput,
): Promise<SettlementResult> {
  try {
    const settlement = await saveChallanPodCharges(
      await getActiveCompanyId(),
      id,
      expectedVersion,
      input,
    );
    touched(id);
    return { ok: true, settlement };
  } catch (e) {
    return toFailure(e);
  }
}

export async function settleChallanAction(id: string, expectedVersion: number): Promise<StateResult> {
  try {
    const state = await settleChallan(await getActiveCompanyId(), id, expectedVersion);
    touched(id);
    return { ok: true, state };
  } catch (e) {
    return toFailure(e);
  }
}

export async function reopenChallanAction(
  id: string,
  expectedVersion: number,
  input: ReopenChallanInput,
): Promise<StateResult> {
  try {
    const state = await reopenChallan(await getActiveCompanyId(), id, expectedVersion, input);
    touched(id);
    return { ok: true, state };
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

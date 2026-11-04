"use server";

// Server actions for the Market vehicles screen. Role checks happen in lib/data (master.edit).
import { getActiveCompanyId } from "@/lib/data/session";
import {
  createMarketVehicle,
  listMarketVehicleOptions,
  updateMarketVehicle,
  type MarketVehicleOptions,
} from "@/lib/data/market-vehicles";
import type { MarketVehicle } from "@/lib/types";
import type { MarketVehicleInput, MarketVehiclePatch } from "@/lib/validators/market-vehicle";
import { toFailure, type ActionFailure } from "../failure";

export async function addMarketVehicleAction(
  input: MarketVehicleInput,
): Promise<{ ok: true; vehicle: MarketVehicle } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    return { ok: true, vehicle: await createMarketVehicle(companyId, input) };
  } catch (e) {
    return toFailure(e);
  }
}

export async function updateMarketVehicleAction(
  id: string,
  expectedVersion: number,
  patch: MarketVehiclePatch,
): Promise<{ ok: true; vehicle: MarketVehicle } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    return { ok: true, vehicle: await updateMarketVehicle(companyId, id, expectedVersion, patch) };
  } catch (e) {
    return toFailure(e);
  }
}

/** Owners and vehicle types for the vehicle form (the vehicle's current ones are always included). */
export async function marketVehicleOptionsAction(
  ownerPartyId?: string | null,
  vehicleTypeId?: string | null,
): Promise<MarketVehicleOptions> {
  return listMarketVehicleOptions(await getActiveCompanyId(), { ownerPartyId, vehicleTypeId });
}

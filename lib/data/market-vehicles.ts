import type { MarketVehicle, Page } from "@/lib/types";
import {
  marketVehicleFields,
  marketVehiclePatchSchema,
  type MarketVehicleInput,
  type MarketVehiclePatch,
} from "@/lib/validators/market-vehicle";
import { parseInput, type ListParams } from "./_store";
import * as dbmv from "./db/market-vehicles";
import { assertCan } from "./session";

// Market vehicles exist on the database only (no mock half); the role rule is master.edit.

export type MarketVehicleListParams = ListParams;
export type MarketVehicleRow = MarketVehicle & {
  ownerName: string | null;
  vehicleTypeName: string | null;
};
export type MarketVehicleOptions = {
  owners: { id: string; name: string; mobile: string | null }[];
  types: { id: string; name: string; capacityKg: number | null }[];
};

export function listMarketVehicleRows(
  companyId: string,
  params: MarketVehicleListParams = {},
): Promise<Page<MarketVehicleRow>> {
  return dbmv.listMarketVehicleRows(companyId, params);
}

export function listMarketVehicleOptions(
  companyId: string,
  include: { ownerPartyId?: string | null; vehicleTypeId?: string | null } = {},
): Promise<MarketVehicleOptions> {
  return dbmv.listMarketVehicleOptions(companyId, include);
}

export async function createMarketVehicle(
  companyId: string,
  input: MarketVehicleInput,
): Promise<MarketVehicle> {
  await assertCan(companyId, "master.edit");
  return dbmv.insertMarketVehicle(companyId, parseInput(marketVehicleFields, input));
}

export async function updateMarketVehicle(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: MarketVehiclePatch,
): Promise<MarketVehicle> {
  await assertCan(companyId, "master.edit");
  return dbmv.updateMarketVehicle(
    companyId,
    id,
    expectedVersion,
    parseInput(marketVehiclePatchSchema, patch),
  );
}

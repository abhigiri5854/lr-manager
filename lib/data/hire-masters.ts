import type {
  Branch,
  ChargeType,
  HireNumberSeries,
  Pump,
  VehicleType,
} from "@/lib/types";
import {
  branchFields,
  branchPatchSchema,
  chargeTypeFields,
  chargeTypePatchSchema,
  pumpFields,
  pumpPatchSchema,
  seriesCounterSchema,
  seriesFields,
  vehicleTypeFields,
  vehicleTypePatchSchema,
  type BranchInput,
  type BranchPatch,
  type ChargeTypeInput,
  type ChargeTypePatch,
  type PumpInput,
  type PumpPatch,
  type SeriesCounterInput,
  type SeriesInput,
  type SeriesKey,
  type VehicleTypeInput,
  type VehicleTypePatch,
} from "@/lib/validators/hire-master";
import { parseInput } from "./_store";
import * as db from "./db/hire-masters";
import { assertCan } from "./session";

// Hire masters exist on the database only (no mock half); the role rule is master.edit.
// Lists are small per-company masters, so they come back whole (capped at 500) instead of paged.

export const listVehicleTypes = (companyId: string): Promise<VehicleType[]> =>
  db.vehicleTypes.list(companyId);
export const listChargeTypes = (companyId: string): Promise<ChargeType[]> =>
  db.chargeTypes.list(companyId);
export const listPumps = (companyId: string): Promise<Pump[]> => db.pumps.list(companyId);
export const listBranches = (companyId: string): Promise<Branch[]> => db.branches.list(companyId);
export const listHireSeries = (companyId: string): Promise<HireNumberSeries[]> =>
  db.listSeries(companyId);

export async function createVehicleType(companyId: string, input: VehicleTypeInput) {
  await assertCan(companyId, "master.edit");
  return db.vehicleTypes.insert(companyId, parseInput(vehicleTypeFields, input));
}
export async function updateVehicleType(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: VehicleTypePatch,
) {
  await assertCan(companyId, "master.edit");
  return db.vehicleTypes.update(companyId, id, expectedVersion, parseInput(vehicleTypePatchSchema, patch));
}

export async function createChargeType(companyId: string, input: ChargeTypeInput) {
  await assertCan(companyId, "master.edit");
  return db.chargeTypes.insert(companyId, parseInput(chargeTypeFields, input));
}
export async function updateChargeType(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: ChargeTypePatch,
) {
  await assertCan(companyId, "master.edit");
  return db.chargeTypes.update(companyId, id, expectedVersion, parseInput(chargeTypePatchSchema, patch));
}

export async function createPump(companyId: string, input: PumpInput) {
  await assertCan(companyId, "master.edit");
  return db.pumps.insert(companyId, parseInput(pumpFields, input));
}
export async function updatePump(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: PumpPatch,
) {
  await assertCan(companyId, "master.edit");
  return db.pumps.update(companyId, id, expectedVersion, parseInput(pumpPatchSchema, patch));
}

export async function createBranch(companyId: string, input: BranchInput) {
  await assertCan(companyId, "master.edit");
  return db.branches.insert(companyId, parseInput(branchFields, input));
}
export async function updateBranch(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: BranchPatch,
) {
  await assertCan(companyId, "master.edit");
  return db.branches.update(companyId, id, expectedVersion, parseInput(branchPatchSchema, patch));
}

export async function createHireSeries(companyId: string, input: SeriesInput) {
  await assertCan(companyId, "master.edit");
  return db.insertSeries(companyId, parseInput(seriesFields, input));
}
export async function updateHireSeries(
  companyId: string,
  key: SeriesKey,
  input: SeriesCounterInput,
) {
  await assertCan(companyId, "master.edit");
  return db.updateSeries(companyId, key, parseInput(seriesCounterSchema, input));
}

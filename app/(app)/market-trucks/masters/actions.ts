"use server";

// Server actions for the hire masters screen. Role checks happen in lib/data (master.edit).
import { assertCan, getActiveCompanyId } from "@/lib/data/session";
import {
  createBranch,
  createChargeType,
  createHireSeries,
  createPump,
  createVehicleType,
  updateBranch,
  updateChargeType,
  updateHireSeries,
  updatePump,
  updateVehicleType,
} from "@/lib/data/hire-masters";
import { updateHireSettings } from "@/lib/data/hire-settings";
import type {
  Branch,
  ChargeType,
  HireNumberSeries,
  Pump,
  VehicleType,
} from "@/lib/types";
import type {
  BranchInput,
  BranchPatch,
  ChargeTypeInput,
  ChargeTypePatch,
  PumpInput,
  PumpPatch,
  SeriesCounterInput,
  SeriesInput,
  SeriesKey,
  VehicleTypeInput,
  VehicleTypePatch,
} from "@/lib/validators/hire-master";
import type { HireSettings, HireSettingsInput } from "@/lib/validators/hire-settings";
import { toFailure, type ActionFailure } from "../failure";

type Saved<T> = { ok: true; row: T } | ActionFailure;

async function run<T>(fn: (companyId: string) => Promise<T>): Promise<Saved<T>> {
  const companyId = await getActiveCompanyId();
  try {
    return { ok: true, row: await fn(companyId) };
  } catch (e) {
    return toFailure(e);
  }
}

export const addVehicleTypeAction = async (input: VehicleTypeInput): Promise<Saved<VehicleType>> =>
  run((c) => createVehicleType(c, input));
export const updateVehicleTypeAction = async (
  id: string,
  version: number,
  patch: VehicleTypePatch,
): Promise<Saved<VehicleType>> => run((c) => updateVehicleType(c, id, version, patch));

export const addChargeTypeAction = async (input: ChargeTypeInput): Promise<Saved<ChargeType>> =>
  run((c) => createChargeType(c, input));
export const updateChargeTypeAction = async (
  id: string,
  version: number,
  patch: ChargeTypePatch,
): Promise<Saved<ChargeType>> => run((c) => updateChargeType(c, id, version, patch));

export const addPumpAction = async (input: PumpInput): Promise<Saved<Pump>> =>
  run((c) => createPump(c, input));
export const updatePumpAction = async (
  id: string,
  version: number,
  patch: PumpPatch,
): Promise<Saved<Pump>> => run((c) => updatePump(c, id, version, patch));

export const addBranchAction = async (input: BranchInput): Promise<Saved<Branch>> =>
  run((c) => createBranch(c, input));
export const updateBranchAction = async (
  id: string,
  version: number,
  patch: BranchPatch,
): Promise<Saved<Branch>> => run((c) => updateBranch(c, id, version, patch));

/** Like run(), but a Postgres "permission denied" (42501) becomes a friendly message. */
async function runSeries<T>(fn: (companyId: string) => Promise<T>): Promise<Saved<T>> {
  try {
    return await run(fn);
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "42501") {
      return { ok: false, kind: "error", message: "You don't have permission to change number series" };
    }
    throw e;
  }
}

// Number series are Owner-only (company.manage, same as the Settings tab); RLS enforces it too (0022).
export const addSeriesAction = async (input: SeriesInput): Promise<Saved<HireNumberSeries>> =>
  runSeries(async (c) => {
    await assertCan(c, "company.manage");
    return createHireSeries(c, input);
  });
export const updateSeriesAction = async (
  key: SeriesKey,
  input: SeriesCounterInput,
): Promise<Saved<HireNumberSeries>> =>
  runSeries(async (c) => {
    await assertCan(c, "company.manage");
    return updateHireSeries(c, key, input);
  });

export const updateHireSettingsAction = async (
  version: number,
  input: HireSettingsInput,
): Promise<Saved<HireSettings>> => run((c) => updateHireSettings(c, version, input));

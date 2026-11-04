"use server";

// Server actions for the Market drivers screen. Role checks happen in lib/data (master.edit).
import { getActiveCompanyId } from "@/lib/data/session";
import { createMarketDriver, updateMarketDriver } from "@/lib/data/market-drivers";
import type { MarketDriver } from "@/lib/types";
import type { MarketDriverInput, MarketDriverPatch } from "@/lib/validators/market-driver";
import { toFailure, type ActionFailure } from "../failure";

export async function addMarketDriverAction(
  input: MarketDriverInput,
): Promise<{ ok: true; driver: MarketDriver } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    return { ok: true, driver: await createMarketDriver(companyId, input) };
  } catch (e) {
    return toFailure(e);
  }
}

export async function updateMarketDriverAction(
  id: string,
  expectedVersion: number,
  patch: MarketDriverPatch,
): Promise<{ ok: true; driver: MarketDriver } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    return { ok: true, driver: await updateMarketDriver(companyId, id, expectedVersion, patch) };
  } catch (e) {
    return toFailure(e);
  }
}

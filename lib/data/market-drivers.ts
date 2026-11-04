import type { MarketDriver, Page } from "@/lib/types";
import {
  marketDriverFields,
  marketDriverPatchSchema,
  type MarketDriverInput,
  type MarketDriverPatch,
} from "@/lib/validators/market-driver";
import { parseInput, type ListParams } from "./_store";
import * as dbmd from "./db/market-drivers";
import { assertCan } from "./session";

// Market drivers exist on the database only (no mock half); the role rule is master.edit.

export type MarketDriverListParams = ListParams;

export function listMarketDriverRows(
  companyId: string,
  params: MarketDriverListParams = {},
): Promise<Page<MarketDriver>> {
  return dbmd.listMarketDriverRows(companyId, params);
}

export async function createMarketDriver(
  companyId: string,
  input: MarketDriverInput,
): Promise<MarketDriver> {
  await assertCan(companyId, "master.edit");
  return dbmd.insertMarketDriver(companyId, parseInput(marketDriverFields, input));
}

export async function updateMarketDriver(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: MarketDriverPatch,
): Promise<MarketDriver> {
  await assertCan(companyId, "master.edit");
  return dbmd.updateMarketDriver(
    companyId,
    id,
    expectedVersion,
    parseInput(marketDriverPatchSchema, patch),
  );
}

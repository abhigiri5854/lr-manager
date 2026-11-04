// Market (hired) drivers on the database.
import type { MarketDriver, Page } from "@/lib/types";
import type { MarketDriverValues } from "@/lib/validators/market-driver";
import { newId } from "../_store";
import type { MarketDriverListParams } from "../market-drivers";
import { contains, paging, withUser, withUserRead } from "./conn";
import { audit, toMarketDriver } from "./rows";
import { truckDocPathFromUrl } from "./storage";
import { columns, insertRow, saveRow } from "./write";

const DRIVER_COLUMNS: Partial<Record<keyof MarketDriverValues, string>> = {
  name: "name",
  mobile: "mobile",
  dlNo: "dl_no",
  dlUpto: "dl_upto",
};

export async function listMarketDriverRows(
  companyId: string,
  params: MarketDriverListParams,
): Promise<Page<MarketDriver>> {
  const { page, pageSize, offset } = paging(params);
  const q = contains(params.search);
  return withUserRead(async (tx) => {
    const where = () => tx`company_id = ${companyId} and cancelled_at is null
                           ${
                             q
                               ? tx`and (lower(name) like ${q} or coalesce(mobile, '') like ${q}
                                         or lower(coalesce(dl_no, '')) like ${q})`
                               : tx``
                           }`;
    const [rows, [{ n }]] = await Promise.all([
      tx`select * from market_drivers where ${where()}
          order by lower(name), id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from market_drivers where ${where()}`,
    ]);
    return { rows: rows.map(toMarketDriver), total: n as number, page, pageSize };
  });
}

export async function insertMarketDriver(
  companyId: string,
  v: MarketDriverValues,
): Promise<MarketDriver> {
  const id = newId();
  return withUser(async (tx) => {
    const r = await insertRow(tx, "market_drivers", {
      id,
      company_id: companyId,
      ...columns(v, DRIVER_COLUMNS),
      dl_file: truckDocPathFromUrl(companyId, v.dlFileUrl),
    });
    const saved = toMarketDriver(r);
    audit(tx, companyId, "market_drivers", saved.id, "create", null, saved);
    return saved;
  });
}

export async function updateMarketDriver(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<MarketDriverValues>,
): Promise<MarketDriver> {
  return withUser(async (tx) => {
    const set = columns(patch, DRIVER_COLUMNS);
    if ("dlFileUrl" in patch) set.dl_file = truckDocPathFromUrl(companyId, patch.dlFileUrl);
    const { before, after } = await saveRow(tx, "market_drivers", companyId, id, expectedVersion, set, {
      what: "Driver",
    });
    const saved = toMarketDriver(after);
    audit(tx, companyId, "market_drivers", id, "update", toMarketDriver(before), saved);
    return saved;
  });
}

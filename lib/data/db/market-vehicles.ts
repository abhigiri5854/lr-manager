// Market (hired) vehicles on the database.
import type { MarketVehicle, Page } from "@/lib/types";
import type { MarketVehicleValues } from "@/lib/validators/market-vehicle";
import { newId } from "../_store";
import type {
  MarketVehicleListParams,
  MarketVehicleOptions,
  MarketVehicleRow,
} from "../market-vehicles";
import { contains, paging, withUser, withUserRead, type Tx } from "./conn";
import { audit, toMarketVehicle } from "./rows";
import { truckDocPathFromUrl } from "./storage";
import { check, columns, insertRow, refCheck, saveRow, type Fragment } from "./write";

const VEHICLE_COLUMNS: Partial<Record<keyof MarketVehicleValues, string>> = {
  vehicleNo: "vehicle_no",
  ownerPartyId: "owner_party_id",
  vehicleTypeId: "vehicle_type_id",
  capacityKg: "capacity_kg",
  rcOwnerName: "rc_owner_name",
  insuranceUpto: "insurance_upto",
  fitnessUpto: "fitness_upto",
  permitUpto: "permit_upto",
  pucUpto: "puc_upto",
};

function numberCheck(tx: Tx, companyId: string, vehicleNo: string | Fragment, exceptId?: string) {
  return check(
    tx,
    "vehicleNo",
    "This vehicle number is already saved",
    tx`exists (select 1 from market_vehicles
                where company_id = ${companyId} and vehicle_no = ${vehicleNo}
                  and cancelled_at is null and id is distinct from ${exceptId ?? null})`,
  );
}

function refChecks(tx: Tx, companyId: string, v: Partial<MarketVehicleValues>) {
  return [
    ...refCheck(tx, companyId, "truck_parties", "ownerPartyId", "Owner", v.ownerPartyId),
    ...refCheck(tx, companyId, "vehicle_types", "vehicleTypeId", "Vehicle type", v.vehicleTypeId),
  ];
}

export async function listMarketVehicleRows(
  companyId: string,
  params: MarketVehicleListParams,
): Promise<Page<MarketVehicleRow>> {
  const { page, pageSize, offset } = paging(params);
  const q = contains(params.search);
  // Vehicle numbers are stored without spaces, so "br01 gn" must still find BR01GN8331.
  const qNo = contains(params.search?.replace(/[\s\-.]/g, ""));
  return withUserRead(async (tx) => {
    const where = () => tx`v.company_id = ${companyId} and v.cancelled_at is null
                           ${
                             q
                               ? tx`and (lower(v.vehicle_no) like ${qNo ?? q}
                                         or lower(p.name) like ${q}
                                         or lower(coalesce(v.rc_owner_name, '')) like ${q})`
                               : tx``
                           }`;
    const from = tx`market_vehicles v
        left join truck_parties p on p.company_id = v.company_id and p.id = v.owner_party_id
        left join vehicle_types t on t.company_id = v.company_id and t.id = v.vehicle_type_id`;
    const [rows, [{ n }]] = await Promise.all([
      tx`select v.*, p.name as owner_name, t.name as type_name from ${from}
          where ${where()}
          order by v.vehicle_no, v.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from ${from} where ${where()}`,
    ]);
    return {
      rows: rows.map((r) => ({
        ...toMarketVehicle(r),
        ownerName: (r.owner_name as string | null) ?? null,
        vehicleTypeName: (r.type_name as string | null) ?? null,
      })),
      total: n as number,
      page,
      pageSize,
    };
  });
}

/** Owners (owner / both, active) and active vehicle types for the form; the vehicle's current ones always included. */
export async function listMarketVehicleOptions(
  companyId: string,
  include: { ownerPartyId?: string | null; vehicleTypeId?: string | null },
): Promise<MarketVehicleOptions> {
  return withUserRead(async (tx) => {
    const [owners, types] = await Promise.all([
      tx`select id, name, mobile from truck_parties
          where company_id = ${companyId} and cancelled_at is null
            and ((status = 'active' and role in ('owner', 'both')) or id = ${include.ownerPartyId ?? null})
          order by lower(name), id limit 1000`,
      tx`select id, name, capacity_kg from vehicle_types
          where company_id = ${companyId} and cancelled_at is null
            and (active or id = ${include.vehicleTypeId ?? null})
          order by lower(name), id`,
    ]);
    return {
      owners: owners.map((o) => ({
        id: o.id as string,
        name: o.name as string,
        mobile: (o.mobile as string | null) ?? null,
      })),
      types: types.map((t) => ({
        id: t.id as string,
        name: t.name as string,
        capacityKg: (t.capacity_kg as number | null) ?? null,
      })),
    };
  });
}

export async function insertMarketVehicle(
  companyId: string,
  v: MarketVehicleValues,
): Promise<MarketVehicle> {
  const id = newId();
  return withUser(async (tx) => {
    const r = await insertRow(
      tx,
      "market_vehicles",
      {
        id,
        company_id: companyId,
        ...columns(v, VEHICLE_COLUMNS),
        rc_file: truckDocPathFromUrl(companyId, v.rcFileUrl),
      },
      { checks: [numberCheck(tx, companyId, v.vehicleNo), ...refChecks(tx, companyId, v)] },
    );
    const saved = toMarketVehicle(r);
    audit(tx, companyId, "market_vehicles", saved.id, "create", null, saved);
    return saved;
  });
}

export async function updateMarketVehicle(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<MarketVehicleValues>,
): Promise<MarketVehicle> {
  return withUser(async (tx) => {
    const set = columns(patch, VEHICLE_COLUMNS);
    if ("rcFileUrl" in patch) set.rc_file = truckDocPathFromUrl(companyId, patch.rcFileUrl);
    const { before, after } = await saveRow(tx, "market_vehicles", companyId, id, expectedVersion, set, {
      what: "Vehicle",
      checks: [
        ...(patch.vehicleNo ? [numberCheck(tx, companyId, patch.vehicleNo, id)] : []),
        ...refChecks(tx, companyId, patch),
      ],
    });
    const saved = toMarketVehicle(after);
    audit(tx, companyId, "market_vehicles", id, "update", toMarketVehicle(before), saved);
    return saved;
  });
}

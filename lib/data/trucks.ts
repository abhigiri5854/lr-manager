import { normaliseMobile, normaliseVehicleNo } from "@/lib/validators/common";
import type { Driver, DriverView, Page, Truck, TruckView } from "@/lib/types";
import {
  driverFields,
  driverPatchSchema,
  truckFields,
  truckPatchSchema,
  type DriverInput,
  type DriverPatch,
  type TruckInput,
  type TruckPatch,
} from "@/lib/validators/truck";
import {
  assertRef,
  cancelRecord,
  db,
  fail,
  findById,
  insertRecord,
  matchesSearch,
  newId,
  now,
  paginate,
  parseInput,
  scoped,
  updateRecord,
  type ListParams,
} from "./_store";

export type TruckListParams = ListParams & { includeCancelled?: boolean };

function toTruckView(t: Truck): TruckView {
  const d = t.driverId ? db.drivers.find((x) => x.id === t.driverId) : undefined;
  return { ...structuredClone(t), driverMobile: d?.mobile ?? null, driverName: d?.name ?? null };
}

function toDriverView(d: Driver): DriverView {
  const trucks = scoped(db.trucks, d.companyId).filter((t) => t.driverId === d.id);
  return { ...structuredClone(d), truckNumbers: trucks.map((t) => t.number) };
}

function assertUniqueNumber(companyId: string, number: string, exceptId?: string) {
  if (scoped(db.trucks, companyId).some((t) => t.number === number && t.id !== exceptId)) {
    fail("number", `Truck ${number} is already saved`);
  }
}

function assertUniqueMobile(companyId: string, mobile: string, exceptId?: string) {
  if (scoped(db.drivers, companyId).some((d) => d.mobile === mobile && d.id !== exceptId)) {
    fail("mobile", `A driver with mobile ${mobile} is already saved`);
  }
}

// ---------- trucks ----------
export async function listTrucks(
  companyId: string,
  params: TruckListParams = {},
): Promise<Page<TruckView>> {
  const q = params.search ? normaliseVehicleNo(params.search) : "";
  const rows = scoped(db.trucks, companyId, params.includeCancelled)
    .map(toTruckView)
    .filter(
      (t) =>
        !q || t.number.includes(q) || matchesSearch(params.search, t.driverMobile, t.driverName),
    )
    .sort((a, b) => a.number.localeCompare(b.number));
  return paginate(rows, params);
}

export async function getTruckById(companyId: string, id: string): Promise<TruckView | null> {
  const t = findById(db.trucks, companyId, id);
  return t ? toTruckView(t) : null;
}

/** "br 01 gn 8331" finds BR01GN8331. */
export async function findTruckByNumber(
  companyId: string,
  number: string,
): Promise<TruckView | null> {
  const n = normaliseVehicleNo(number);
  const t = scoped(db.trucks, companyId).find((x) => x.number === n);
  return t ? toTruckView(t) : null;
}

export async function createTruck(companyId: string, input: TruckInput): Promise<TruckView> {
  const v = parseInput(truckFields, input);
  assertRef(db.drivers, companyId, v.driverId, "driverId", "Driver");
  assertUniqueNumber(companyId, v.number);
  const t = now();
  const truck: Truck = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    number: v.number,
    driverId: v.driverId ?? null,
    rcExpiry: v.rcExpiry ?? null,
    insuranceExpiry: v.insuranceExpiry ?? null,
    permitExpiry: v.permitExpiry ?? null,
    fitnessExpiry: v.fitnessExpiry ?? null,
    source: v.source ?? "manual",
  };
  return toTruckView(insertRecord("trucks", db.trucks, truck));
}

export async function updateTruck(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: TruckPatch,
): Promise<TruckView> {
  const p = parseInput(truckPatchSchema, patch);
  assertRef(db.drivers, companyId, p.driverId, "driverId", "Driver");
  if (p.number) assertUniqueNumber(companyId, p.number, id);
  const saved = updateRecord(
    "trucks",
    db.trucks,
    companyId,
    id,
    expectedVersion,
    (c) => ({ ...c, ...p }),
    "Truck",
  );
  return toTruckView(saved);
}

export async function cancelTruck(companyId: string, id: string): Promise<TruckView> {
  return toTruckView(cancelRecord("trucks", db.trucks, companyId, id, "Truck"));
}

// ---------- drivers ----------
export async function listDrivers(
  companyId: string,
  params: TruckListParams = {},
): Promise<Page<DriverView>> {
  const digits = params.search ? normaliseMobile(params.search) : "";
  const rows = scoped(db.drivers, companyId, params.includeCancelled)
    .filter(
      (d) =>
        (digits !== "" && d.mobile.includes(digits)) ||
        matchesSearch(params.search, d.name, d.licenceNo),
    )
    .sort((a, b) => a.mobile.localeCompare(b.mobile))
    .map(toDriverView);
  return paginate(rows, params);
}

export async function getDriverById(companyId: string, id: string): Promise<DriverView | null> {
  const d = findById(db.drivers, companyId, id);
  return d ? toDriverView(d) : null;
}

export async function createDriver(companyId: string, input: DriverInput): Promise<DriverView> {
  const v = parseInput(driverFields, input);
  assertUniqueMobile(companyId, v.mobile);
  const t = now();
  const driver: Driver = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    mobile: v.mobile,
    name: v.name ?? null,
    licenceNo: v.licenceNo ?? null,
    licenceExpiry: v.licenceExpiry ?? null,
    userId: v.userId ?? null,
    invitedAt: null,
  };
  return toDriverView(insertRecord("drivers", db.drivers, driver));
}

export async function updateDriver(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: DriverPatch,
): Promise<DriverView> {
  const p = parseInput(driverPatchSchema, patch);
  if (p.mobile) assertUniqueMobile(companyId, p.mobile, id);
  const saved = updateRecord(
    "drivers",
    db.drivers,
    companyId,
    id,
    expectedVersion,
    (c) => ({ ...c, ...p }),
    "Driver",
  );
  return toDriverView(saved);
}

export async function cancelDriver(companyId: string, id: string): Promise<DriverView> {
  return toDriverView(cancelRecord("drivers", db.drivers, companyId, id, "Driver"));
}

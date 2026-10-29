import { daysUntil, EXPIRY_WARN_DAYS } from "@/lib/expiry";
import { isGoodsMoving } from "@/lib/lr-status";
import type {
  AttentionItem,
  Driver,
  DriverRow,
  DriverView,
  LrView,
  Page,
  Truck,
  TruckRow,
  TruckView,
} from "@/lib/types";
import { normaliseMobile, normaliseVehicleNo } from "@/lib/validators/common";
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
import { toLrView } from "./_derive";
import {
  assertRef,
  cancelRecord,
  db,
  fail,
  findById,
  getOrThrow,
  insertRecord,
  matchesSearch,
  newId,
  now,
  paginate,
  parseInput,
  scoped,
  today,
  updateRecord,
  type ListParams,
  authorStamp,
} from "./_store";
import * as dbt from "./db/trucks";
import { assertCan } from "./session";
import { onDatabase } from "./source";

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
  if (onDatabase()) return dbt.listTrucks(companyId, params);
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

export type TruckSuggestion = TruckView & { lastLrNo: string | null };

/** Up to 8 trucks for the LR form's truck autocomplete, with the latest LR each was on. */
export async function listTruckSuggestions(
  companyId: string,
  search: string,
): Promise<TruckSuggestion[]> {
  if (onDatabase()) return dbt.listTruckSuggestions(companyId, search);
  const { rows } = await listTrucks(companyId, { search, pageSize: 8 });
  const lrs = scoped(db.lrs, companyId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.map((t) => ({
    ...t,
    lastLrNo: lrs.find((lr) => lr.truckId === t.id)?.lrNo ?? null,
  }));
}

/** Every active truck as id + number, for filter dropdowns (not paginated). */
export async function listTruckOptions(
  companyId: string,
): Promise<{ id: string; number: string }[]> {
  if (onDatabase()) return dbt.listTruckOptions(companyId);
  return scoped(db.trucks, companyId)
    .map((t) => ({ id: t.id, number: t.number }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

export async function getTruckById(companyId: string, id: string): Promise<TruckView | null> {
  if (onDatabase()) return dbt.getTruckById(companyId, id);
  const t = findById(db.trucks, companyId, id);
  return t ? toTruckView(t) : null;
}

/** "br 01 gn 8331" finds BR01GN8331. */
export async function findTruckByNumber(
  companyId: string,
  number: string,
): Promise<TruckView | null> {
  if (onDatabase()) return dbt.findTruckByNumber(companyId, number);
  const n = normaliseVehicleNo(number);
  const t = scoped(db.trucks, companyId).find((x) => x.number === n);
  return t ? toTruckView(t) : null;
}

export async function createTruck(companyId: string, input: TruckInput): Promise<TruckView> {
  await assertCan(companyId, "master.edit");
  const v = parseInput(truckFields, input);
  if (!onDatabase()) {
    assertRef(db.drivers, companyId, v.driverId, "driverId", "Driver");
    assertUniqueNumber(companyId, v.number);
  }
  const t = now();
  const truck: Truck = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...authorStamp(),
    number: v.number,
    driverId: v.driverId ?? null,
    rcExpiry: v.rcExpiry ?? null,
    insuranceExpiry: v.insuranceExpiry ?? null,
    permitExpiry: v.permitExpiry ?? null,
    fitnessExpiry: v.fitnessExpiry ?? null,
    source: v.source ?? "manual",
  };
  if (onDatabase()) return dbt.insertTruck(truck);
  return toTruckView(insertRecord("trucks", db.trucks, truck));
}

export async function updateTruck(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: TruckPatch,
): Promise<TruckView> {
  await assertCan(companyId, "master.edit");
  const p = parseInput(truckPatchSchema, patch);
  if (onDatabase()) return dbt.updateTruck(companyId, id, expectedVersion, p);
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

/** Cancels a truck that isn't on an undelivered LR. */
export async function cancelTruck(companyId: string, id: string): Promise<TruckView> {
  await assertCan(companyId, "record.cancel");
  if (onDatabase()) return dbt.cancelTruck(companyId, id);
  const truck = getOrThrow(db.trucks, companyId, id, "Truck");
  const blocked = cancelBlockedReason("truck", openLrsFor(companyId, { truckIds: [truck.id] }));
  if (blocked) fail("", blocked);
  return toTruckView(cancelRecord("trucks", db.trucks, companyId, id, "Truck"));
}

// ---------- drivers ----------
export async function listDrivers(
  companyId: string,
  params: TruckListParams = {},
): Promise<Page<DriverView>> {
  if (onDatabase()) return dbt.listDrivers(companyId, params);
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
  if (onDatabase()) return dbt.getDriverById(companyId, id);
  const d = findById(db.drivers, companyId, id);
  return d ? toDriverView(d) : null;
}

export async function createDriver(companyId: string, input: DriverInput): Promise<DriverView> {
  await assertCan(companyId, "master.edit");
  const v = parseInput(driverFields, input);
  if (!onDatabase()) assertUniqueMobile(companyId, v.mobile);
  const t = now();
  const driver: Driver = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...authorStamp(),
    mobile: v.mobile,
    name: v.name ?? null,
    licenceNo: v.licenceNo ?? null,
    licenceExpiry: v.licenceExpiry ?? null,
    userId: v.userId ?? null,
    invitedAt: null,
  };
  if (onDatabase()) return dbt.insertDriver(driver);
  return toDriverView(insertRecord("drivers", db.drivers, driver));
}

export async function updateDriver(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: DriverPatch,
): Promise<DriverView> {
  await assertCan(companyId, "master.edit");
  const p = parseInput(driverPatchSchema, patch);
  if (onDatabase()) return dbt.updateDriver(companyId, id, expectedVersion, p);
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

/** Cancels a driver who isn't on an undelivered LR, and unlinks them from their trucks. */
export async function cancelDriver(companyId: string, id: string): Promise<DriverView> {
  await assertCan(companyId, "record.cancel");
  if (onDatabase()) return dbt.cancelDriver(companyId, id);
  const driver = getOrThrow(db.drivers, companyId, id, "Driver");
  const open = openLrsFor(companyId, driverMatch(companyId, driver));
  const blocked = cancelBlockedReason("driver", open);
  if (blocked) fail("", blocked);
  for (const t of scoped(db.trucks, companyId).filter((x) => x.driverId === id)) {
    const unlink = (c: Truck): Truck => ({ ...c, driverId: null });
    updateRecord("trucks", db.trucks, companyId, t.id, t.version, unlink, "Truck");
  }
  return toDriverView(cancelRecord("drivers", db.drivers, companyId, id, "Driver"));
}

/** "Invite to driver app": records when it was sent. No SMS goes out until messaging is wired. */
export async function inviteDriver(companyId: string, id: string): Promise<DriverView> {
  await assertCan(companyId, "company.manage");
  if (onDatabase()) return dbt.inviteDriver(companyId, id);
  const d = getOrThrow(db.drivers, companyId, id, "Driver");
  const stamp = (c: Driver): Driver => ({ ...c, invitedAt: now() });
  return toDriverView(
    updateRecord("drivers", db.drivers, companyId, id, d.version, stamp, "Driver"),
  );
}

// ---------- table rows, cancel rules, expiry alerts ----------
type OpenLrQuery = { truckIds: string[]; driverMobile?: string };

/** Undelivered (draft, booked or in transit) LRs for these trucks or this driver mobile. */
function openLrsFor(companyId: string, q: OpenLrQuery): LrView[] {
  return scoped(db.lrs, companyId)
    .filter(
      (lr) =>
        (lr.truckId !== null && q.truckIds.includes(lr.truckId)) ||
        (q.driverMobile !== undefined && lr.driverMobile === q.driverMobile),
    )
    .map(toLrView)
    .filter((lr) => isGoodsMoving(lr.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function driverMatch(companyId: string, d: Driver): OpenLrQuery {
  const truckIds = scoped(db.trucks, companyId)
    .filter((t) => t.driverId === d.id)
    .map((t) => t.id);
  return { truckIds, driverMobile: d.mobile };
}

/** Why a truck / driver can't be cancelled (its undelivered LRs), or null. */
export function cancelBlockedReason(
  what: "truck" | "driver",
  open: Pick<LrView, "lrNo" | "status">[],
): string | null {
  if (open.length === 0) return null;
  const list = open
    .slice(0, 3)
    .map((lr) => `LR ${lr.lrNo} (${lr.status.toLowerCase()})`)
    .join(", ");
  const more = open.length > 3 ? ` and ${open.length - 3} more` : "";
  const them = open.length === 1 ? "it" : "them";
  return `On ${list}${more}. Deliver or cancel ${them} first, then this ${what} can be cancelled.`;
}

/** Truck's current trip: an undelivered LR if any, else the latest one. */
function tripFor(companyId: string, truckId: string): TruckRow["trip"] {
  const lrs = scoped(db.lrs, companyId)
    .filter((lr) => lr.truckId === truckId)
    .map(toLrView)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lr = lrs.find((x) => isGoodsMoving(x.status)) ?? lrs[0];
  return lr ? { lrId: lr.id, lrNo: lr.lrNo, status: lr.status } : null;
}

/** Trucks list with each truck's trip and cancel rule, for /trucks. */
export async function listTruckRows(
  companyId: string,
  params: TruckListParams = {},
): Promise<Page<TruckRow>> {
  if (onDatabase()) return dbt.listTruckRows(companyId, params);
  const page = await listTrucks(companyId, params);
  return {
    ...page,
    rows: page.rows.map((t) => ({
      ...t,
      trip: tripFor(companyId, t.id),
      cancelBlockedBy: cancelBlockedReason("truck", openLrsFor(companyId, { truckIds: [t.id] })),
    })),
  };
}

/** Drivers list with each driver's cancel rule, for /trucks. */
export async function listDriverRows(
  companyId: string,
  params: TruckListParams = {},
): Promise<Page<DriverRow>> {
  if (onDatabase()) return dbt.listDriverRows(companyId, params);
  const page = await listDrivers(companyId, params);
  return {
    ...page,
    rows: page.rows.map((d) => {
      const open = openLrsFor(companyId, driverMatch(companyId, d));
      return { ...d, cancelBlockedBy: cancelBlockedReason("driver", open) };
    }),
  };
}

/** Every active driver, for the "Driver" dropdowns (not paginated). */
export async function listDriverOptions(
  companyId: string,
): Promise<{ id: string; label: string }[]> {
  if (onDatabase()) return dbt.listDriverOptions(companyId);
  return scoped(db.drivers, companyId)
    .sort((a, b) => a.mobile.localeCompare(b.mobile))
    .map((d) => ({ id: d.id, label: d.name ? `${d.name} · ${d.mobile}` : d.mobile }));
}

const TRUCK_DOCS = [
  ["rcExpiry", "RC"],
  ["insuranceExpiry", "Insurance"],
  ["permitExpiry", "Permit"],
  ["fitnessExpiry", "Fitness"],
] as const;

/** Truck documents and driver licences that are expired or lapse within 15 days, soonest first. */
export async function listExpiryAlerts(companyId: string): Promise<AttentionItem[]> {
  if (onDatabase()) return dbt.listExpiryAlerts(companyId);
  const day = today();
  const items: Extract<AttentionItem, { kind: "doc_expiry" }>[] = [];
  const add = (
    owner: "truck" | "driver",
    ownerLabel: string,
    doc: string,
    expiresOn: string | null,
  ) => {
    if (!expiresOn) return;
    const daysLeft = daysUntil(expiresOn, day);
    if (daysLeft <= EXPIRY_WARN_DAYS) {
      items.push({ kind: "doc_expiry", owner, ownerLabel, doc, expiresOn, daysLeft });
    }
  };
  for (const t of scoped(db.trucks, companyId)) {
    for (const [field, doc] of TRUCK_DOCS) add("truck", t.number, doc, t[field]);
  }
  for (const d of scoped(db.drivers, companyId)) {
    add("driver", d.name ?? d.mobile, "Licence", d.licenceExpiry);
  }
  return items.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

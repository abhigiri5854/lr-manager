// Trucks & drivers on the database (DATA_SOURCE=db). Same behaviour as the mock half of
// ../trucks.ts. LR status comes from lib/lr-status.ts on the seven stamps stored on lrs.
import { daysUntil, EXPIRY_WARN_DAYS } from "@/lib/expiry";
import { deriveLrStatus, isGoodsMoving } from "@/lib/lr-status";
import type {
  AttentionItem,
  Driver,
  DriverRow,
  DriverView,
  LrStatus,
  Page,
  Truck,
  TruckRow,
  TruckView,
} from "@/lib/types";
import { normaliseMobile, normaliseVehicleNo } from "@/lib/validators/common";
import { fail, today } from "../_store";
import { contains, paging, withUser, type Tx } from "./conn";
import { uuidList } from "./parties";
import { audit, toDriver, toTruck, type Row } from "./rows";
import { cancelRow, columns, lockForUpdate, lockRow, updateVersioned } from "./write";
import { cancelBlockedReason, type TruckListParams, type TruckSuggestion } from "../trucks";

const TRUCK_COLUMNS: Partial<Record<keyof Truck, string>> = {
  number: "number",
  driverId: "driver_id",
  rcExpiry: "rc_expiry",
  insuranceExpiry: "insurance_expiry",
  permitExpiry: "permit_expiry",
  fitnessExpiry: "fitness_expiry",
  source: "source",
};

const DRIVER_COLUMNS: Partial<Record<keyof Driver, string>> = {
  mobile: "mobile",
  name: "name",
  licenceNo: "licence_no",
  licenceExpiry: "licence_expiry",
  userId: "user_id",
  invitedAt: "invited_at",
};

type OpenLr = {
  id: string;
  lrNo: string;
  status: LrStatus;
  truckId: string | null;
  driverMobile: string | null;
};

const statusOf = (r: Row): LrStatus =>
  deriveLrStatus({
    cancelledAt: r.cancelled_at ?? undefined,
    bookedAt: r.booked_at,
    dispatchedAt: r.dispatched_at,
    deliveredAt: r.delivered_at,
    podReceivedAt: r.pod_received_at,
    billedAt: r.billed_at,
    paidAt: r.paid_at,
  });

/** SQL twin of isGoodsMoving(deriveLrStatus(lr)): draft, booked or in transit. */
const MOVING =
  "cancelled_at is null and (booked_at is null or (paid_at is null and billed_at is null and pod_received_at is null and delivered_at is null))";

// ---------- views ----------
const TRUCK_SELECT = (tx: Tx) => tx`
  select t.*, d.mobile as driver_mobile_v, d.name as driver_name_v
    from trucks t left join drivers d on d.company_id = t.company_id and d.id = t.driver_id`;

function toTruckView(r: Row): TruckView {
  return {
    ...toTruck(r),
    driverMobile: r.driver_mobile_v ?? null,
    driverName: r.driver_name_v ?? null,
  };
}

const DRIVER_SELECT = (tx: Tx) => tx`
  select d.*, coalesce((select array_agg(t.number order by t.number) from trucks t
                         where t.company_id = d.company_id and t.driver_id = d.id
                           and t.cancelled_at is null), '{}') as truck_numbers
    from drivers d`;

function toDriverView(r: Row): DriverView {
  return { ...toDriver(r), truckNumbers: r.truck_numbers as string[] };
}

// ---------- reads ----------
export async function listTrucks(
  companyId: string,
  params: TruckListParams,
): Promise<Page<TruckView>> {
  const { page, pageSize, offset } = paging(params);
  const number = params.search ? normaliseVehicleNo(params.search) : "";
  const q = contains(params.search);
  return withUser(async (tx) => {
    const where = () => tx`t.company_id = ${companyId}
      ${params.includeCancelled ? tx`` : tx`and t.cancelled_at is null`}
      ${
        number && q
          ? tx`and (t.number like ${`%${number}%`} or lower(d.mobile) like ${q} or lower(d.name) like ${q})`
          : tx``
      }`;
    const [rows, [{ n }]] = await Promise.all([
      tx`${TRUCK_SELECT(tx)} where ${where()} order by t.number, t.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from trucks t
           left join drivers d on d.company_id = t.company_id and d.id = t.driver_id
          where ${where()}`,
    ]);
    return { rows: rows.map(toTruckView), total: n as number, page, pageSize };
  });
}

export async function listTruckSuggestions(
  companyId: string,
  search: string,
): Promise<TruckSuggestion[]> {
  const { rows } = await listTrucks(companyId, { search, pageSize: 8 });
  if (rows.length === 0) return [];
  return withUser(async (tx) => {
    const last = await tx`
      select distinct on (truck_id) truck_id, lr_no from lrs
       where company_id = ${companyId} and cancelled_at is null
         and truck_id = any (string_to_array(${uuidList(rows.map((t) => t.id))}, ',')::uuid[])
       order by truck_id, created_at desc`;
    const byTruck = new Map(last.map((r) => [r.truck_id as string, r.lr_no as string]));
    return rows.map((t) => ({ ...t, lastLrNo: byTruck.get(t.id) ?? null }));
  });
}

export async function listTruckOptions(companyId: string) {
  return withUser(async (tx) => {
    const rows = await tx`select id, number from trucks
                           where company_id = ${companyId} and cancelled_at is null order by number, id`;
    return rows.map((r) => ({ id: r.id as string, number: r.number as string }));
  });
}

export async function getTruckById(companyId: string, id: string): Promise<TruckView | null> {
  return withUser(async (tx) => {
    const [r] = await tx`${TRUCK_SELECT(tx)} where t.company_id = ${companyId} and t.id = ${id}`;
    return r ? toTruckView(r) : null;
  });
}

export async function findTruckByNumber(
  companyId: string,
  number: string,
): Promise<TruckView | null> {
  const n = normaliseVehicleNo(number);
  return withUser(async (tx) => {
    const [r] = await tx`${TRUCK_SELECT(tx)}
                          where t.company_id = ${companyId} and t.number = ${n} and t.cancelled_at is null`;
    return r ? toTruckView(r) : null;
  });
}

export async function listDrivers(
  companyId: string,
  params: TruckListParams,
): Promise<Page<DriverView>> {
  const { page, pageSize, offset } = paging(params);
  const digits = params.search ? normaliseMobile(params.search) : "";
  const q = contains(params.search);
  return withUser(async (tx) => {
    const where = () => tx`d.company_id = ${companyId}
      ${params.includeCancelled ? tx`` : tx`and d.cancelled_at is null`}
      ${
        q
          ? tx`and (${digits !== ""} and d.mobile like ${`%${digits}%`}
                 or lower(d.name) like ${q} or lower(d.licence_no) like ${q})`
          : tx``
      }`;
    const [rows, [{ n }]] = await Promise.all([
      tx`${DRIVER_SELECT(tx)} where ${where()} order by d.mobile, d.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from drivers d where ${where()}`,
    ]);
    return { rows: rows.map(toDriverView), total: n as number, page, pageSize };
  });
}

export async function getDriverById(companyId: string, id: string): Promise<DriverView | null> {
  return withUser(async (tx) => {
    const [r] = await tx`${DRIVER_SELECT(tx)} where d.company_id = ${companyId} and d.id = ${id}`;
    return r ? toDriverView(r) : null;
  });
}

export async function listDriverOptions(companyId: string) {
  return withUser(async (tx) => {
    const rows = await tx`select id, mobile, name from drivers
                           where company_id = ${companyId} and cancelled_at is null order by mobile, id`;
    return rows.map((d) => ({
      id: d.id as string,
      label: d.name ? `${d.name} · ${d.mobile}` : (d.mobile as string),
    }));
  });
}

// ---------- open LRs (cancel rules, trips) ----------
/** Undelivered LRs on these trucks or with these driver mobiles, oldest first. */
async function openLrs(
  tx: Tx,
  companyId: string,
  truckIds: string[],
  mobiles: string[],
): Promise<OpenLr[]> {
  if (truckIds.length === 0 && mobiles.length === 0) return [];
  const rows = await tx`
    select id, lr_no, truck_id, driver_mobile, cancelled_at, booked_at, dispatched_at, delivered_at,
           pod_received_at, billed_at, paid_at
      from lrs
     where company_id = ${companyId} and ${tx.unsafe(MOVING)}
       and (truck_id = any (string_to_array(${uuidList(truckIds)}, ',')::uuid[])
            or driver_mobile = any (string_to_array(${mobiles.join(",")}, ',')))
     order by created_at, id`;
  return rows
    .map((r) => ({
      id: r.id as string,
      lrNo: r.lr_no as string,
      status: statusOf(r),
      truckId: r.truck_id as string | null,
      driverMobile: r.driver_mobile as string | null,
    }))
    .filter((lr) => isGoodsMoving(lr.status));
}

async function driverTruckIds(tx: Tx, companyId: string, driverIds: string[]) {
  if (driverIds.length === 0) return new Map<string, string[]>();
  const rows = await tx`select id, driver_id from trucks
                         where company_id = ${companyId} and cancelled_at is null
                           and driver_id = any (string_to_array(${uuidList(driverIds)}, ',')::uuid[])`;
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.driver_id, [...(map.get(r.driver_id) ?? []), r.id]);
  return map;
}

export async function listTruckRows(
  companyId: string,
  params: TruckListParams,
): Promise<Page<TruckRow>> {
  const page = await listTrucks(companyId, params);
  const ids = page.rows.map((t) => t.id);
  if (ids.length === 0) return { ...page, rows: [] };
  return withUser(async (tx) => {
    const [open, trips] = await Promise.all([
      openLrs(tx, companyId, ids, []),
      // Current trip: the newest undelivered LR, else the newest LR.
      tx`select distinct on (truck_id) id, lr_no, truck_id, cancelled_at, booked_at, dispatched_at,
                delivered_at, pod_received_at, billed_at, paid_at
           from lrs
          where company_id = ${companyId} and cancelled_at is null
            and truck_id = any (string_to_array(${uuidList(ids)}, ',')::uuid[])
          order by truck_id, (${tx.unsafe(MOVING)}) desc, created_at desc`,
    ]);
    const tripOf = new Map(trips.map((r) => [r.truck_id as string, r]));
    return {
      ...page,
      rows: page.rows.map((t) => {
        const trip = tripOf.get(t.id);
        return {
          ...t,
          trip: trip ? { lrId: trip.id, lrNo: trip.lr_no, status: statusOf(trip) } : null,
          cancelBlockedBy: cancelBlockedReason(
            "truck",
            open.filter((lr) => lr.truckId === t.id),
          ),
        };
      }),
    };
  });
}

export async function listDriverRows(
  companyId: string,
  params: TruckListParams,
): Promise<Page<DriverRow>> {
  const page = await listDrivers(companyId, params);
  if (page.rows.length === 0) return { ...page, rows: [] };
  return withUser(async (tx) => {
    const trucksOf = await driverTruckIds(
      tx,
      companyId,
      page.rows.map((d) => d.id),
    );
    const allTrucks = [...trucksOf.values()].flat();
    const open = await openLrs(
      tx,
      companyId,
      allTrucks,
      page.rows.map((d) => d.mobile),
    );
    return {
      ...page,
      rows: page.rows.map((d) => {
        const mine = trucksOf.get(d.id) ?? [];
        const theirs = open.filter(
          (lr) =>
            (lr.truckId !== null && mine.includes(lr.truckId)) || lr.driverMobile === d.mobile,
        );
        return { ...d, cancelBlockedBy: cancelBlockedReason("driver", theirs) };
      }),
    };
  });
}

// ---------- writes (permission already checked in ../trucks.ts) ----------
async function assertDriverRef(tx: Tx, companyId: string, driverId: string | null | undefined) {
  if (!driverId) return;
  const [d] = await tx`select 1 from drivers
                        where company_id = ${companyId} and id = ${driverId} and cancelled_at is null`;
  if (!d) fail("driverId", "Driver not found in this company");
}

async function assertUniqueNumber(tx: Tx, companyId: string, number: string, exceptId?: string) {
  const [t] = await tx`select 1 from trucks where company_id = ${companyId} and number = ${number}
                        and cancelled_at is null and id is distinct from ${exceptId ?? null}`;
  if (t) fail("number", `Truck ${number} is already saved`);
}

async function assertUniqueMobile(tx: Tx, companyId: string, mobile: string, exceptId?: string) {
  const [d] = await tx`select 1 from drivers where company_id = ${companyId} and mobile = ${mobile}
                        and cancelled_at is null and id is distinct from ${exceptId ?? null}`;
  if (d) fail("mobile", `A driver with mobile ${mobile} is already saved`);
}

async function truckView(tx: Tx, companyId: string, id: string): Promise<TruckView> {
  const [r] = await tx`${TRUCK_SELECT(tx)} where t.company_id = ${companyId} and t.id = ${id}`;
  return toTruckView(r);
}

async function driverView(tx: Tx, companyId: string, id: string): Promise<DriverView> {
  const [r] = await tx`${DRIVER_SELECT(tx)} where d.company_id = ${companyId} and d.id = ${id}`;
  return toDriverView(r);
}

export async function insertTruck(truck: Truck): Promise<TruckView> {
  return withUser(async (tx) => {
    await assertDriverRef(tx, truck.companyId, truck.driverId);
    await assertUniqueNumber(tx, truck.companyId, truck.number);
    const [r] = await tx`insert into trucks ${tx({
      id: truck.id,
      company_id: truck.companyId,
      ...columns(truck, TRUCK_COLUMNS),
    })} returning *`;
    await audit(tx, truck.companyId, "trucks", r.id, "create", null, toTruck(r));
    return truckView(tx, truck.companyId, r.id);
  });
}

export async function updateTruck(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<Truck>,
): Promise<TruckView> {
  return withUser(async (tx) => {
    await assertDriverRef(tx, companyId, patch.driverId);
    if (patch.number) await assertUniqueNumber(tx, companyId, patch.number, id);
    const current = toTruck(
      await lockForUpdate(tx, "trucks", companyId, id, expectedVersion, "Truck"),
    );
    const saved = toTruck(
      await updateVersioned(
        tx,
        "trucks",
        companyId,
        id,
        expectedVersion,
        columns(patch, TRUCK_COLUMNS),
      ),
    );
    await audit(tx, companyId, "trucks", id, "update", current, saved);
    return truckView(tx, companyId, id);
  });
}

export async function cancelTruck(companyId: string, id: string): Promise<TruckView> {
  return withUser(async (tx) => {
    await lockRow(tx, "trucks", companyId, id, "Truck");
    const blocked = cancelBlockedReason("truck", await openLrs(tx, companyId, [id], []));
    if (blocked) fail("", blocked);
    const { before, after, changed } = await cancelRow(tx, "trucks", companyId, id, "Truck");
    if (changed)
      await audit(tx, companyId, "trucks", id, "cancel", toTruck(before), toTruck(after));
    return truckView(tx, companyId, id);
  });
}

export async function insertDriver(driver: Driver): Promise<DriverView> {
  return withUser(async (tx) => {
    await assertUniqueMobile(tx, driver.companyId, driver.mobile);
    const [r] = await tx`insert into drivers ${tx({
      id: driver.id,
      company_id: driver.companyId,
      ...columns(driver, DRIVER_COLUMNS),
    })} returning *`;
    await audit(tx, driver.companyId, "drivers", r.id, "create", null, toDriver(r));
    return driverView(tx, driver.companyId, r.id);
  });
}

export async function updateDriver(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<Driver>,
): Promise<DriverView> {
  return withUser(async (tx) => {
    if (patch.mobile) await assertUniqueMobile(tx, companyId, patch.mobile, id);
    const current = toDriver(
      await lockForUpdate(tx, "drivers", companyId, id, expectedVersion, "Driver"),
    );
    const saved = toDriver(
      await updateVersioned(
        tx,
        "drivers",
        companyId,
        id,
        expectedVersion,
        columns(patch, DRIVER_COLUMNS),
      ),
    );
    await audit(tx, companyId, "drivers", id, "update", current, saved);
    return driverView(tx, companyId, id);
  });
}

/** Cancels a driver who isn't on an undelivered LR, and unlinks them from their trucks. */
export async function cancelDriver(companyId: string, id: string): Promise<DriverView> {
  return withUser(async (tx) => {
    const driver = toDriver(await lockRow(tx, "drivers", companyId, id, "Driver"));
    const trucks = (await driverTruckIds(tx, companyId, [id])).get(id) ?? [];
    const blocked = cancelBlockedReason(
      "driver",
      await openLrs(tx, companyId, trucks, [driver.mobile]),
    );
    if (blocked) fail("", blocked);
    for (const truckId of trucks) {
      const before = toTruck(await lockRow(tx, "trucks", companyId, truckId, "Truck"));
      const after = toTruck(
        await updateVersioned(tx, "trucks", companyId, truckId, before.version, {
          driver_id: null,
        }),
      );
      await audit(tx, companyId, "trucks", truckId, "update", before, after);
    }
    const { before, after, changed } = await cancelRow(tx, "drivers", companyId, id, "Driver");
    if (changed)
      await audit(tx, companyId, "drivers", id, "cancel", toDriver(before), toDriver(after));
    return driverView(tx, companyId, id);
  });
}

export async function inviteDriver(companyId: string, id: string): Promise<DriverView> {
  return withUser(async (tx) => {
    const current = toDriver(await lockRow(tx, "drivers", companyId, id, "Driver"));
    if (current.cancelledAt) fail("", "This driver is cancelled and can't be changed");
    const saved = toDriver(
      await updateVersioned(tx, "drivers", companyId, id, current.version, {
        invited_at: new Date().toISOString(),
      }),
    );
    await audit(tx, companyId, "drivers", id, "update", current, saved);
    return driverView(tx, companyId, id);
  });
}

// ---------- expiry alerts ----------
const TRUCK_DOCS = [
  ["rcExpiry", "RC"],
  ["insuranceExpiry", "Insurance"],
  ["permitExpiry", "Permit"],
  ["fitnessExpiry", "Fitness"],
] as const;

export async function listExpiryAlerts(companyId: string): Promise<AttentionItem[]> {
  const day = today();
  return withUser(async (tx) => {
    const cutoff = tx`(${day}::date + ${EXPIRY_WARN_DAYS}::int)`;
    const [trucks, drivers] = await Promise.all([
      tx`select * from trucks where company_id = ${companyId} and cancelled_at is null
           and least(rc_expiry, insurance_expiry, permit_expiry, fitness_expiry) <= ${cutoff}`,
      tx`select * from drivers where company_id = ${companyId} and cancelled_at is null
           and licence_expiry <= ${tx`(${day}::date + ${EXPIRY_WARN_DAYS}::int)`}`,
    ]);
    const items: Extract<AttentionItem, { kind: "doc_expiry" }>[] = [];
    const add = (
      owner: "truck" | "driver",
      ownerLabel: string,
      doc: string,
      expiresOn: string | null,
    ) => {
      if (!expiresOn) return;
      const daysLeft = daysUntil(expiresOn, day);
      if (daysLeft <= EXPIRY_WARN_DAYS)
        items.push({ kind: "doc_expiry", owner, ownerLabel, doc, expiresOn, daysLeft });
    };
    for (const t of trucks.map(toTruck))
      for (const [field, doc] of TRUCK_DOCS) add("truck", t.number, doc, t[field]);
    for (const d of drivers.map(toDriver))
      add("driver", d.name ?? d.mobile, "Licence", d.licenceExpiry);
    return items.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  });
}

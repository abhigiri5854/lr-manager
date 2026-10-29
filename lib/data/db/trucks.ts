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
import { contains, paging, withUser, withUserRead, type Tx } from "./conn";
import { uuidList } from "./parties";
import { audit, toDriver, toTruck, type Row } from "./rows";
import {
  cancelRow,
  check,
  columns,
  insertRow,
  lockRow,
  saveRow,
  type Fragment,
} from "./write";
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

/** Columns of a driver view on alias d (or a CTE row with the same columns). */
const DRIVER_COLS = (tx: Tx, d: Fragment = tx`d`) => tx`
  coalesce((select array_agg(t.number order by t.number) from trucks t
             where t.company_id = ${d}.company_id and t.driver_id = ${d}.id
               and t.cancelled_at is null), '{}') as truck_numbers`;

const DRIVER_SELECT = (tx: Tx) => tx`select d.*, ${DRIVER_COLS(tx)} from drivers d`;

function toDriverView(r: Row): DriverView {
  return { ...toDriver(r), truckNumbers: r.truck_numbers as string[] };
}

// ---------- reads ----------
/** Trucks list filter (alias t, drivers joined as d): search by number, driver mobile or name. */
function truckWhere(tx: Tx, companyId: string, params: TruckListParams) {
  const number = params.search ? normaliseVehicleNo(params.search) : "";
  const q = contains(params.search);
  return tx`t.company_id = ${companyId}
    ${params.includeCancelled ? tx`` : tx`and t.cancelled_at is null`}
    ${
      number && q
        ? tx`and (t.number like ${`%${number}%`} or lower(d.mobile) like ${q} or lower(d.name) like ${q})`
        : tx``
    }`;
}

/** Drivers list filter (alias d): search by mobile, name or licence no. */
function driverWhere(tx: Tx, companyId: string, params: TruckListParams) {
  const digits = params.search ? normaliseMobile(params.search) : "";
  const q = contains(params.search);
  return tx`d.company_id = ${companyId}
    ${params.includeCancelled ? tx`` : tx`and d.cancelled_at is null`}
    ${
      q
        ? tx`and (${digits !== ""} and d.mobile like ${`%${digits}%`}
               or lower(d.name) like ${q} or lower(d.licence_no) like ${q})`
        : tx``
    }`;
}

export async function listTrucks(
  companyId: string,
  params: TruckListParams,
): Promise<Page<TruckView>> {
  const { page, pageSize, offset } = paging(params);
  return withUserRead(async (tx) => {
    const where = () => truckWhere(tx, companyId, params);
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
  return withUserRead(async (tx) => {
    const rows = await tx`${TRUCK_SELECT(tx)}
      left join lateral (select lr_no as last_lr_no from lrs
                          where company_id = t.company_id and cancelled_at is null and truck_id = t.id
                          order by created_at desc limit 1) last on true
      where ${truckWhere(tx, companyId, { search })}
      order by t.number, t.id limit 8`;
    return rows.map((r) => ({ ...toTruckView(r), lastLrNo: (r.last_lr_no as string | null) ?? null }));
  });
}

export async function listTruckOptions(companyId: string) {
  return withUserRead(async (tx) => {
    const rows = await tx`select id, number from trucks
                           where company_id = ${companyId} and cancelled_at is null order by number, id`;
    return rows.map((r) => ({ id: r.id as string, number: r.number as string }));
  });
}

export async function getTruckById(companyId: string, id: string): Promise<TruckView | null> {
  return withUserRead(async (tx) => {
    const [r] = await tx`${TRUCK_SELECT(tx)} where t.company_id = ${companyId} and t.id = ${id}`;
    return r ? toTruckView(r) : null;
  });
}

export async function findTruckByNumber(
  companyId: string,
  number: string,
): Promise<TruckView | null> {
  const n = normaliseVehicleNo(number);
  return withUserRead(async (tx) => {
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
  return withUserRead(async (tx) => {
    const where = () => driverWhere(tx, companyId, params);
    const [rows, [{ n }]] = await Promise.all([
      tx`${DRIVER_SELECT(tx)} where ${where()} order by d.mobile, d.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from drivers d where ${where()}`,
    ]);
    return { rows: rows.map(toDriverView), total: n as number, page, pageSize };
  });
}

export async function getDriverById(companyId: string, id: string): Promise<DriverView | null> {
  return withUserRead(async (tx) => {
    const [r] = await tx`${DRIVER_SELECT(tx)} where d.company_id = ${companyId} and d.id = ${id}`;
    return r ? toDriverView(r) : null;
  });
}

export async function listDriverOptions(companyId: string) {
  return withUserRead(async (tx) => {
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

/** An LR's stamps as json (for json_agg) → the derived status, with its ids. */
const STAMPS_JSON = "'cancelled_at', cancelled_at, 'booked_at', booked_at, 'dispatched_at', dispatched_at, 'delivered_at', delivered_at, 'pod_received_at', pod_received_at, 'billed_at', billed_at, 'paid_at', paid_at";
const OPEN_LR_JSON = `json_build_object('id', id, 'lr_no', lr_no, 'truck_id', truck_id, 'driver_mobile', driver_mobile, ${STAMPS_JSON})`;

function toOpenLrs(list: Row[] | null): OpenLr[] {
  return (list ?? [])
    .map((r) => ({
      id: r.id as string,
      lrNo: r.lr_no as string,
      status: statusOf(r),
      truckId: r.truck_id as string | null,
      driverMobile: r.driver_mobile as string | null,
    }))
    .filter((lr) => isGoodsMoving(lr.status));
}

/** Trucks page: each truck with its driver, current trip and cancel block — one round trip. */
export async function listTruckRows(
  companyId: string,
  params: TruckListParams,
): Promise<Page<TruckRow>> {
  const { page, pageSize, offset } = paging(params);
  return withUserRead(async (tx) => {
    const where = truckWhere(tx, companyId, params);
    const [rows, [{ n }]] = await Promise.all([
      tx`
        select t.*, d.mobile as driver_mobile_v, d.name as driver_name_v, trip.trip, o.open_lrs
          from trucks t
          left join drivers d on d.company_id = t.company_id and d.id = t.driver_id
          -- Current trip: the newest undelivered LR, else the newest LR.
          left join lateral (
            select json_build_object('id', id, 'lr_no', lr_no, ${tx.unsafe(STAMPS_JSON)}) as trip
              from lrs where company_id = t.company_id and cancelled_at is null and truck_id = t.id
             order by (${tx.unsafe(MOVING)}) desc, created_at desc limit 1) trip on true
          left join lateral (
            select json_agg(${tx.unsafe(OPEN_LR_JSON)} order by created_at, id) as open_lrs
              from lrs where company_id = t.company_id and ${tx.unsafe(MOVING)} and truck_id = t.id) o on true
         where ${where}
         order by t.number, t.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from trucks t
           left join drivers d on d.company_id = t.company_id and d.id = t.driver_id
          where ${truckWhere(tx, companyId, params)}`,
    ]);
    return {
      rows: rows.map((r) => ({
        ...toTruckView(r),
        trip: r.trip ? { lrId: r.trip.id, lrNo: r.trip.lr_no, status: statusOf(r.trip) } : null,
        cancelBlockedBy: cancelBlockedReason("truck", toOpenLrs(r.open_lrs)),
      })),
      total: n as number,
      page,
      pageSize,
    };
  });
}

/** Drivers page: each driver with their trucks and cancel block — one round trip. */
export async function listDriverRows(
  companyId: string,
  params: TruckListParams,
): Promise<Page<DriverRow>> {
  const { page, pageSize, offset } = paging(params);
  return withUserRead(async (tx) => {
    const [rows, [{ n }]] = await Promise.all([
      tx`select d.*, ${DRIVER_COLS(tx)}, o.open_lrs from drivers d
          left join lateral (
            select json_agg(${tx.unsafe(OPEN_LR_JSON)} order by created_at, id) as open_lrs
              from lrs where company_id = d.company_id and ${tx.unsafe(MOVING)}
               and (driver_mobile = d.mobile
                    or truck_id in (select t.id from trucks t where t.company_id = d.company_id
                                       and t.cancelled_at is null and t.driver_id = d.id))) o on true
         where ${driverWhere(tx, companyId, params)}
         order by d.mobile, d.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from drivers d where ${driverWhere(tx, companyId, params)}`,
    ]);
    return {
      rows: rows.map((r) => ({
        ...toDriverView(r),
        cancelBlockedBy: cancelBlockedReason("driver", toOpenLrs(r.open_lrs)),
      })),
      total: n as number,
      page,
      pageSize,
    };
  });
}

// ---------- writes (permission already checked in ../trucks.ts) ----------
// One statement per save (write.ts): lock + checks + update + the view columns below.
function driverRefCheck(tx: Tx, companyId: string, driverId: string) {
  return check(
    tx,
    "driverId",
    "Driver not found in this company",
    tx`not exists (select 1 from drivers where company_id = ${companyId} and id = ${driverId}
                     and cancelled_at is null)`,
  );
}

function numberCheck(tx: Tx, companyId: string, number: string, exceptId?: string) {
  return check(
    tx,
    "number",
    `Truck ${number} is already saved`,
    tx`exists (select 1 from trucks where company_id = ${companyId} and number = ${number}
                 and cancelled_at is null and id is distinct from ${exceptId ?? null})`,
  );
}

function mobileCheck(tx: Tx, companyId: string, mobile: string, exceptId?: string) {
  return check(
    tx,
    "mobile",
    `A driver with mobile ${mobile} is already saved`,
    tx`exists (select 1 from drivers where company_id = ${companyId} and mobile = ${mobile}
                 and cancelled_at is null and id is distinct from ${exceptId ?? null})`,
  );
}

/** The driver's mobile and name next to a saved truck row (TruckView). */
const TRUCK_VIEW_COLS = (tx: Tx) => (a: Fragment) => tx`,
  (select d.mobile from drivers d where d.company_id = ${a}.company_id and d.id = ${a}.driver_id) as driver_mobile_v,
  (select d.name from drivers d where d.company_id = ${a}.company_id and d.id = ${a}.driver_id) as driver_name_v`;

/** The driver's truck numbers next to a saved driver row (DriverView). */
const DRIVER_VIEW_COLS = (tx: Tx) => (a: Fragment) => tx`, ${DRIVER_COLS(tx, a)}`;

export async function insertTruck(truck: Truck): Promise<TruckView> {
  return withUser(async (tx) => {
    const r = await insertRow(
      tx,
      "trucks",
      { id: truck.id, company_id: truck.companyId, ...columns(truck, TRUCK_COLUMNS) },
      {
        checks: [
          ...(truck.driverId ? [driverRefCheck(tx, truck.companyId, truck.driverId)] : []),
          numberCheck(tx, truck.companyId, truck.number),
        ],
        extra: TRUCK_VIEW_COLS(tx),
      },
    );
    audit(tx, truck.companyId, "trucks", r.id, "create", null, toTruck(r));
    return toTruckView(r);
  });
}

export async function updateTruck(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<Truck>,
): Promise<TruckView> {
  return withUser(async (tx) => {
    const { before, after } = await saveRow(
      tx,
      "trucks",
      companyId,
      id,
      expectedVersion,
      columns(patch, TRUCK_COLUMNS),
      {
        what: "Truck",
        checks: [
          ...(patch.driverId ? [driverRefCheck(tx, companyId, patch.driverId)] : []),
          ...(patch.number ? [numberCheck(tx, companyId, patch.number, id)] : []),
        ],
        extra: TRUCK_VIEW_COLS(tx),
      },
    );
    audit(tx, companyId, "trucks", id, "update", toTruck(before), toTruck(after));
    return toTruckView(after);
  });
}

export async function cancelTruck(companyId: string, id: string): Promise<TruckView> {
  return withUser(async (tx) => {
    const [, open] = await Promise.all([
      lockRow(tx, "trucks", companyId, id, "Truck"),
      openLrs(tx, companyId, [id], []),
    ]);
    const blocked = cancelBlockedReason("truck", open);
    if (blocked) fail("", blocked);
    const { before, after, changed } = await cancelRow(
      tx,
      "trucks",
      companyId,
      id,
      "Truck",
      undefined,
      TRUCK_VIEW_COLS(tx),
    );
    if (changed) audit(tx, companyId, "trucks", id, "cancel", toTruck(before), toTruck(after));
    return toTruckView(after);
  });
}

export async function insertDriver(driver: Driver): Promise<DriverView> {
  return withUser(async (tx) => {
    const r = await insertRow(
      tx,
      "drivers",
      { id: driver.id, company_id: driver.companyId, ...columns(driver, DRIVER_COLUMNS) },
      {
        checks: [mobileCheck(tx, driver.companyId, driver.mobile)],
        extra: DRIVER_VIEW_COLS(tx),
      },
    );
    audit(tx, driver.companyId, "drivers", r.id, "create", null, toDriver(r));
    return toDriverView(r);
  });
}

export async function updateDriver(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<Driver>,
): Promise<DriverView> {
  return withUser(async (tx) => {
    const { before, after } = await saveRow(
      tx,
      "drivers",
      companyId,
      id,
      expectedVersion,
      columns(patch, DRIVER_COLUMNS),
      {
        what: "Driver",
        checks: patch.mobile ? [mobileCheck(tx, companyId, patch.mobile, id)] : [],
        extra: DRIVER_VIEW_COLS(tx),
      },
    );
    audit(tx, companyId, "drivers", id, "update", toDriver(before), toDriver(after));
    return toDriverView(after);
  });
}

/** Cancels a driver who isn't on an undelivered LR, and unlinks them from their trucks. */
export async function cancelDriver(companyId: string, id: string): Promise<DriverView> {
  return withUser(async (tx) => {
    const [row, trucksOf] = await Promise.all([
      lockRow(tx, "drivers", companyId, id, "Driver"),
      driverTruckIds(tx, companyId, [id]),
    ]);
    const driver = toDriver(row);
    const trucks = trucksOf.get(id) ?? [];
    const blocked = cancelBlockedReason(
      "driver",
      await openLrs(tx, companyId, trucks, [driver.mobile]),
    );
    if (blocked) fail("", blocked);
    // Unlink from every truck in one statement; each truck still gets its audit row.
    const unlinked = trucks.length
      ? await tx`
          with cur as (select * from trucks where company_id = ${companyId} and driver_id = ${id}
                          and cancelled_at is null for update),
               upd as (update trucks t set driver_id = null from cur
                        where t.company_id = cur.company_id and t.id = cur.id returning t.*)
          select 'before' as k, cur.* from cur union all select 'after', upd.* from upd`
      : [];
    for (const after of unlinked.filter((r) => r.k === "after")) {
      const before = unlinked.find((r) => r.k === "before" && r.id === after.id)!;
      audit(tx, companyId, "trucks", after.id, "update", toTruck(before), toTruck(after));
    }
    const { before, after, changed } = await cancelRow(
      tx,
      "drivers",
      companyId,
      id,
      "Driver",
      undefined,
      DRIVER_VIEW_COLS(tx),
    );
    if (changed) audit(tx, companyId, "drivers", id, "cancel", toDriver(before), toDriver(after));
    return toDriverView(after);
  });
}

export async function inviteDriver(companyId: string, id: string): Promise<DriverView> {
  return withUser(async (tx) => {
    const { before, after } = await saveRow(
      tx,
      "drivers",
      companyId,
      id,
      null,
      { invited_at: new Date().toISOString() },
      { what: "Driver", extra: DRIVER_VIEW_COLS(tx) },
    );
    audit(tx, companyId, "drivers", id, "update", toDriver(before), toDriver(after));
    return toDriverView(after);
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
  return withUserRead(async (tx) => {
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

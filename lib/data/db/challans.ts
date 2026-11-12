// Market-truck hire challans on the database (TIER1-MARKET-TRUCKS.md §5, §6 screen 1).
import type { ChallanInsightQuery, ChallanInsights } from "@/lib/challan-insights";
import { financialYear } from "@/lib/fy";
import { calcChallan, fromPaise, toPaise } from "@/lib/hire";
import type {
  ChallanChargeLine,
  ChallanLrLine,
  ChallanLrPick,
  ChallanView,
  LrView,
  Page,
  TripEventType,
} from "@/lib/types";
import type { ChallanValues } from "@/lib/validators/challan";
import type { ChallanListFilters } from "@/lib/validators/challan-list";
import { newId } from "../_store";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { listLrs } from "../lrs";
import { contains, paging, withCommit, withUser, withUserRead, type Tx } from "./conn";
import { LR_SELECT } from "./lrs";
import {
  audit,
  toChallanChargeLine,
  toChallanLrLine,
  toChallanView,
  toLrView,
  type Row,
} from "./rows";
import { saveRow, uuidsIn } from "./write";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const kgOf = (lr: LrView): number | null => {
  const total = lr.items.reduce((s, i) => s + Number(i.chargedWeight ?? i.actualWeight ?? 0), 0);
  return total > 0 ? total : null;
};

type Usage = { pkgs: number; wt: number; nos: string[] };

/** Packages / kg of each LR already on other live challans (cancelled and transferred lines don't count). */
async function usageFor(
  tx: Tx,
  companyId: string,
  lrIds: string[],
  exceptChallanId: string | null,
): Promise<Map<string, Usage>> {
  if (!lrIds.length) return new Map();
  const rows = await tx`
    select cl.lr_id, sum(cl.loaded_pkgs)::int as pkgs, coalesce(sum(cl.loaded_wt), 0)::float8 as wt,
           array_agg(c.challan_no order by c.challan_no) as nos
      from challan_lrs cl
      join challans c on c.company_id = cl.company_id and c.id = cl.challan_id
     where cl.company_id = ${companyId} and cl.lr_id in ${uuidsIn(tx, lrIds)}
       and c.cancelled_at is null and cl.transferred_to_challan_id is null
       and c.id is distinct from ${exceptChallanId}
     group by cl.lr_id`;
  return new Map(
    rows.map((r) => [
      r.lr_id as string,
      { pkgs: r.pkgs as number, wt: r.wt as number, nos: r.nos as string[] },
    ]),
  );
}

function toPick(lr: LrView, use: Usage | undefined): ChallanLrPick {
  const totalWt = kgOf(lr);
  return {
    lrId: lr.id,
    lrNo: lr.lrNo,
    lrDate: lr.lrDate,
    consignorName: lr.consignorName,
    consigneeName: lr.consigneeName,
    fromPlace: lr.fromPlace,
    toPlace: lr.toPlace,
    totalPkgs: lr.totalPackages,
    totalWt: totalWt === null ? null : totalWt.toFixed(3),
    freightPaise: lr.charges.freight ?? 0,
    remainingPkgs: Math.max(0, lr.totalPackages - (use?.pkgs ?? 0)),
    remainingWt: totalWt === null ? null : Math.max(0, totalWt - (use?.wt ?? 0)).toFixed(3),
    onChallanNos: use?.nos ?? [],
  };
}

/** Booked LRs matching the search (LR no., party, place, truck…), each with what is still free to load. */
export async function searchLrPicks(
  companyId: string,
  search: string,
  exceptChallanId: string | null,
): Promise<ChallanLrPick[]> {
  const page = await listLrs(companyId, { search, pageSize: 15 });
  const lrs = page.rows.filter((l) => l.bookedAt !== null);
  const use = await withUserRead((tx) =>
    usageFor(tx, companyId, lrs.map((l) => l.id), exceptChallanId),
  );
  return lrs.map((l) => toPick(l, use.get(l.id)));
}

/** Owners and brokers share one table; this lists the ones that can be a challan's broker. */
export async function searchBrokers(companyId: string, search: string) {
  const q = contains(search);
  return withUserRead(async (tx) => {
    const rows = await tx`select id, name, mobile from truck_parties
        where company_id = ${companyId} and cancelled_at is null and status = 'active'
          and role in ('broker', 'both')
          ${q ? tx`and (lower(name) like ${q} or coalesce(mobile, '') like ${q})` : tx``}
        order by lower(name), id limit 8`;
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      mobile: (r.mobile as string | null) ?? null,
    }));
  });
}

/** Settings, lane rates, payee / vehicle / driver status and e-way expiries for the challan form's right rail. */
export async function getChallanInsights(
  companyId: string,
  q: ChallanInsightQuery,
): Promise<ChallanInsights> {
  const validId = (s: string | null) => (s && UUID.test(s) ? s : null);
  const vehicleId = validId(q.vehicleId);
  const driverId = validId(q.driverId);
  const brokerId = validId(q.brokerId);
  const lrIds = q.lrIds.filter((x) => UUID.test(x));
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return withUserRead(async (tx) => {
    const [[co], [veh], [drv], [brk], ewb] = await Promise.all([
      tx`select min_margin_pct, rate_outlier_pct, ewb_alert_hours from companies where id = ${companyId}`,
      rowsIf(vehicleId, () =>
        tx`select mv.vehicle_no, mv.vehicle_type_id, mv.insurance_upto::text, mv.fitness_upto::text,
                  mv.permit_upto::text, p.name as owner_name, p.verified as owner_verified,
                  (p.status = 'blacklisted') as owner_blacklisted
             from market_vehicles mv
             left join truck_parties p on p.company_id = mv.company_id and p.id = mv.owner_party_id
            where mv.company_id = ${companyId} and mv.id = ${vehicleId}`,
      ),
      rowsIf(driverId, () =>
        tx`select name, dl_upto::text from market_drivers where company_id = ${companyId} and id = ${driverId}`,
      ),
      rowsIf(brokerId, () =>
        tx`select name, verified, (status = 'blacklisted') as blacklisted from truck_parties
            where company_id = ${companyId} and id = ${brokerId}`,
      ),
      rowsIf(lrIds.length, () =>
        tx`select l.lr_no, min(i.eway_expires_at)::text as expires_at
             from lrs l join lr_invoices i on i.company_id = l.company_id and i.lr_id = l.id
            where l.company_id = ${companyId} and l.id in ${uuidsIn(tx, lrIds)}
              and i.eway_bill_no is not null and i.eway_expires_at is not null
            group by l.lr_no order by l.lr_no`,
      ),
    ]);
    const src = q.source.trim().toLowerCase();
    const dst = q.destination.trim().toLowerCase();
    const [lane] =
      src && dst
        ? await tx`select n, median_rate, rates from v_lane_rates
                    where company_id = ${companyId} and source = ${src} and destination = ${dst}
                      and rate_basis = ${q.rateBasis}::rate_basis
                      and vehicle_type_id is not distinct from ${(veh?.vehicle_type_id as string | null) ?? null}::uuid`
        : [];
    const payee =
      q.payeeKind === "broker"
        ? brk
          ? { name: brk.name as string, verified: !!brk.verified, blacklisted: !!brk.blacklisted }
          : null
        : veh?.owner_name
          ? {
              name: veh.owner_name as string,
              verified: !!veh.owner_verified,
              blacklisted: !!veh.owner_blacklisted,
            }
          : null;
    return {
      settings: {
        minMarginPct: num(co?.min_margin_pct),
        rateOutlierPct: num(co?.rate_outlier_pct),
        ewbAlertHours: num(co?.ewb_alert_hours),
      },
      lane: lane
        ? {
            n: lane.n as number,
            medianRate: String(lane.median_rate),
            rates: (lane.rates as unknown[]).map(String),
          }
        : null,
      vehicle: veh
        ? {
            vehicleNo: veh.vehicle_no as string,
            insuranceUpto: (veh.insurance_upto as string | null) ?? null,
            fitnessUpto: (veh.fitness_upto as string | null) ?? null,
            permitUpto: (veh.permit_upto as string | null) ?? null,
          }
        : null,
      driver: drv ? { name: drv.name as string, dlUpto: (drv.dl_upto as string | null) ?? null } : null,
      payee,
      ewb: ewb.map((r) => ({ lrNo: r.lr_no as string, expiresAt: r.expires_at as string })),
    } satisfies ChallanInsights;
  });
}

async function loadChallan(tx: Tx, companyId: string, id: string): Promise<ChallanView | null> {
  const [[c], lines, charges] = await Promise.all([
    tx`select c.*, (c.challan_at at time zone 'Asia/Kolkata')::date::text as challan_date,
              b.name as branch_name, v.vehicle_no, d.name as driver_name,
              bk.name as broker_name, pp.name as payee_name
         from challans c
         join branches b on b.company_id = c.company_id and b.id = c.branch_id
         left join market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
         left join market_drivers d on d.company_id = c.company_id and d.id = c.driver_id
         left join truck_parties bk on bk.company_id = c.company_id and bk.id = c.broker_id
         left join truck_parties pp on pp.company_id = c.company_id and pp.id = c.payee_party_id
        where c.company_id = ${companyId} and c.id = ${id}`,
    tx`select cl.*, l.lr_no from challan_lrs cl
         join lrs l on l.company_id = cl.company_id and l.id = cl.lr_id
        where cl.company_id = ${companyId} and cl.challan_id = ${id}
        order by cl.created_at, cl.id`,
    tx`select g.*, t.label from challan_charges g
         join charge_types t on t.company_id = g.company_id and t.id = g.charge_type_id
        where g.company_id = ${companyId} and g.challan_id = ${id}
          and g.stage = 'hire' and g.cancelled_at is null
        order by g.created_at, g.id`,
  ]);
  return c ? toChallanView(c, lines.map(toChallanLrLine), charges.map(toChallanChargeLine)) : null;
}

export async function getChallan(companyId: string, id: string): Promise<ChallanView | null> {
  if (!UUID.test(id)) return null;
  return withUserRead((tx) => loadChallan(tx, companyId, id));
}

/** The LR picks for a saved challan's lines (their "remaining" excludes this challan itself). */
export async function getChallanLrPicks(
  companyId: string,
  challanId: string,
  lrIds: string[],
): Promise<ChallanLrPick[]> {
  if (!lrIds.length) return [];
  return withUserRead(async (tx) => {
    const [rows, use] = await Promise.all([
      tx`${LR_SELECT(tx)} where l.company_id = ${companyId} and l.id in ${uuidsIn(tx, lrIds)}`,
      usageFor(tx, companyId, lrIds, challanId),
    ]);
    return rows.map((r) => toPick(toLrView(r), use.get(r.id as string)));
  });
}

const rowsIf = (cond: unknown, run: () => PromiseLike<Row[]>): PromiseLike<Row[]> =>
  cond ? run() : Promise.resolve([]);

const chargeSig = (c: { chargeTypeId: string; amount: string; note: string | null }) =>
  `${c.chargeTypeId}|${fromPaise(toPaise(c.amount))}|${c.note ?? ""}`;

/**
 * Create (id null) or edit a draft challan, optionally dispatching it. The number is allocated in the
 * same statement that inserts the challan (app.allocate_hire_number: row lock per branch + FY).
 */
export async function saveChallan(
  companyId: string,
  id: string | null,
  expectedVersion: number | null,
  v: ChallanValues,
): Promise<ChallanView> {
  return withUser(async (tx) => {
    const lrIds = v.lrs.map((l) => l.lrId);
    const [existing, branches, vehicles, drivers, brokers, types, lrRows, usage] = await Promise.all([
      id ? loadChallan(tx, companyId, id) : Promise.resolve(null),
      tx`select id, name from branches where company_id = ${companyId} and id = ${v.branchId} and cancelled_at is null`,
      rowsIf(v.vehicleId, () =>
        tx`select mv.id, mv.vehicle_no, mv.owner_party_id, mv.vehicle_type_id, p.name as owner_name
             from market_vehicles mv
             left join truck_parties p on p.company_id = mv.company_id and p.id = mv.owner_party_id
            where mv.company_id = ${companyId} and mv.id = ${v.vehicleId ?? null} and mv.cancelled_at is null`,
      ),
      rowsIf(v.driverId, () =>
        tx`select id, name from market_drivers
            where company_id = ${companyId} and id = ${v.driverId ?? null} and cancelled_at is null`,
      ),
      rowsIf(v.brokerId, () =>
        tx`select id, name from truck_parties
            where company_id = ${companyId} and id = ${v.brokerId ?? null} and cancelled_at is null`,
      ),
      rowsIf(v.charges.length, () =>
        tx`select id, label, default_direction, stage, active from charge_types
            where company_id = ${companyId}
              and id in ${uuidsIn(tx, v.charges.map((c) => c.chargeTypeId))}
              and cancelled_at is null`,
      ),
      tx`${LR_SELECT(tx)} where l.company_id = ${companyId} and l.id in ${uuidsIn(tx, lrIds)}`,
      usageFor(tx, companyId, lrIds, id),
    ]);

    if (id) {
      if (!existing) throw new NotFoundError("Challan");
      if (existing.cancelledAt)
        throw new ValidationError([{ path: "", message: "This challan is cancelled" }]);
      if (expectedVersion !== null && existing.version !== expectedVersion) throw new ConflictError();
      if (existing.status !== "draft")
        throw new ValidationError([{ path: "", message: "Only a draft challan can be edited" }]);
    }

    const issues: { path: string; message: string }[] = [];
    const bad = (path: string, message: string) => {
      issues.push({ path, message });
    };
    const [branch] = branches;
    const [vehicle] = vehicles;
    const [driver] = drivers;
    const [broker] = brokers;
    if (!branch) bad("branchId", "Branch not found in this company");
    else if (existing && existing.branchId !== v.branchId)
      bad("branchId", "The branch can't change once the challan has its number");
    if (v.vehicleId && !vehicle) bad("vehicleId", "Vehicle not found in this company");
    if (v.driverId && !driver) bad("driverId", "Driver not found in this company");
    if (v.brokerId && !broker) bad("brokerId", "Broker not found in this company");

    // LR lines: booked, and no more than what is still free to load.
    const views = new Map(lrRows.map((r) => [r.id as string, r]));
    const lines: (ChallanLrLine & { wt: string | null })[] = [];
    v.lrs.forEach((l, i) => {
      const row = views.get(l.lrId);
      if (!row) return bad(`lrs.${i}.lrId`, "LR not found in this company");
      const lr = toLrView(row);
      if (lr.cancelledAt || !lr.bookedAt) return bad(`lrs.${i}.lrId`, `LR ${lr.lrNo} is not booked`);
      const pick = toPick(lr, usage.get(lr.id));
      if (l.loadedPkgs > pick.remainingPkgs)
        return bad(
          `lrs.${i}.loadedPkgs`,
          pick.remainingPkgs === 0
            ? `LR ${lr.lrNo} is fully loaded on ${pick.onChallanNos.join(", ")}`
            : `LR ${lr.lrNo}: only ${pick.remainingPkgs} packages left to load`,
        );
      if (l.loadedWt && pick.remainingWt !== null && Number(l.loadedWt) > Number(pick.remainingWt) + 0.0005)
        return bad(`lrs.${i}.loadedWt`, `LR ${lr.lrNo}: only ${pick.remainingWt} kg left to load`);
      // Weight not typed: the same share of the free weight as of the free packages.
      const wt =
        l.loadedWt ??
        (pick.remainingWt !== null && pick.remainingPkgs > 0
          ? ((Number(pick.remainingWt) * l.loadedPkgs) / pick.remainingPkgs).toFixed(3)
          : null);
      const freight =
        pick.totalPkgs > 0
          ? Math.round((pick.freightPaise * l.loadedPkgs) / pick.totalPkgs)
          : pick.freightPaise;
      lines.push({
        lrId: lr.id,
        lrNo: lr.lrNo,
        loadedPkgs: l.loadedPkgs,
        loadedWt: wt,
        wt,
        freightAllocated: fromPaise(freight),
      });
    });

    // Hire-stage charges only, and only types the company has switched on.
    const typeById = new Map(types.map((t) => [t.id as string, t]));
    const charges: ChallanChargeLine[] = [];
    v.charges.forEach((c, i) => {
      const t = typeById.get(c.chargeTypeId);
      if (!t) return bad(`charges.${i}.chargeTypeId`, "Charge type not found");
      if (!t.active) return bad(`charges.${i}.chargeTypeId`, `${t.label} is switched off in Hire masters`);
      if (t.stage !== "hire")
        return bad(`charges.${i}.chargeTypeId`, `${t.label} is added at POD settlement`);
      charges.push({
        id: newId(),
        chargeTypeId: c.chargeTypeId,
        label: t.label as string,
        direction: t.default_direction,
        amount: fromPaise(toPaise(c.amount)),
        note: c.note ?? null,
      });
    });

    // Pay to OWNER = the vehicle's owner; BROKER = the picked broker.
    const payeeId =
      v.payeeKind === "broker"
        ? (v.brokerId ?? null)
        : ((vehicle?.owner_party_id as string | null | undefined) ?? null);
    const payeeName =
      v.payeeKind === "broker"
        ? ((broker?.name as string | undefined) ?? null)
        : ((vehicle?.owner_name as string | null | undefined) ?? null);
    if (v.action === "dispatch" && v.payeeKind === "owner" && vehicle && !payeeId)
      bad(
        "payeeKind",
        "This vehicle has no owner on file — add the owner in Market vehicles, or pay the broker",
      );
    if (issues.length) throw new ValidationError(issues);

    const calc = calcChallan({
      basis: v.rateBasis,
      rate: v.rate,
      tonnes: v.qtyTonnes,
      charges: charges.map((c) => ({ direction: c.direction, amount: c.amount })),
    });
    const status = v.action === "dispatch" ? "dispatched" : "draft";
    const challanAt = `${v.challanDate}T00:00:00+05:30`;
    const vehicleTypeId = (vehicle?.vehicle_type_id as string | null | undefined) ?? null;
    const cid = id ?? newId();
    const lineRows = lines.map((l) => ({
      lr_id: l.lrId,
      loaded_pkgs: l.loadedPkgs,
      loaded_wt: l.wt,
      freight_allocated: l.freightAllocated,
    }));
    let row: Row;
    if (!id) {
      const fy = financialYear(v.challanDate);
      [row] = await tx`
        with n as (select * from app.allocate_hire_number(${companyId}::uuid, 'challan', ${v.branchId}::uuid, ${fy}::text))
        insert into challans (id, company_id, challan_no, challan_fy, challan_seq, challan_at, branch_id,
                              source, destination, vehicle_id, vehicle_type_id, driver_id, broker_id,
                              payee_party_id, payee_kind, rate_basis, rate, qty_tonnes, hire_amount,
                              remarks, status, dispatched_at)
        select ${cid}::uuid, ${companyId}::uuid, app.format_hire_number(n.prefix, n.no, n.padding),
               ${fy}::text, n.no, ${challanAt}::timestamptz, ${v.branchId}::uuid,
               ${v.source ?? null}::text, ${v.destination ?? null}::text, ${v.vehicleId ?? null}::uuid,
               ${vehicleTypeId}::uuid, ${v.driverId ?? null}::uuid, ${v.brokerId ?? null}::uuid,
               ${payeeId}::uuid, ${v.payeeKind}::payee_kind, ${v.rateBasis}::rate_basis,
               ${v.rate}::numeric, ${v.qtyTonnes ?? null}::numeric, ${calc.hireAmount}::numeric,
               ${v.remarks ?? null}::text, ${status}::challan_status,
               case when ${status}::text = 'dispatched' then now() end
          from n
        returning *`;
    } else {
      // Draft lines can be replaced (RLS allows the delete only while the challan is a draft), so this
      // goes before the status can change. A failed version check below rolls it back.
      await tx`delete from challan_lrs where company_id = ${companyId} and challan_id = ${cid}`;
      const set: Row = {
        source: v.source ?? null,
        destination: v.destination ?? null,
        vehicle_id: v.vehicleId ?? null,
        vehicle_type_id: vehicleTypeId,
        driver_id: v.driverId ?? null,
        broker_id: v.brokerId ?? null,
        payee_party_id: payeeId,
        payee_kind: v.payeeKind,
        rate_basis: v.rateBasis,
        rate: v.rate,
        qty_tonnes: v.qtyTonnes ?? null,
        hire_amount: calc.hireAmount,
        remarks: v.remarks ?? null,
        status,
      };
      if (v.challanDate !== existing!.challanDate) set.challan_at = challanAt;
      if (status === "dispatched") set.dispatched_at = new Date().toISOString();
      ({ after: row } = await saveRow(tx, "challans", companyId, cid, expectedVersion, set, {
        what: "Challan",
      }));
    }

    withCommit(
      tx,
      tx`insert into challan_lrs (company_id, challan_id, lr_id, loaded_pkgs, loaded_wt, freight_allocated, created_by)
         select ${companyId}::uuid, ${cid}::uuid, x.lr_id, x.loaded_pkgs, x.loaded_wt, x.freight_allocated, auth.uid()
           from jsonb_to_recordset(${tx.json(lineRows as never)}::jsonb)
                as x(lr_id uuid, loaded_pkgs int, loaded_wt numeric, freight_allocated numeric)`,
    );
    // Charges can't be deleted (no delete grant). On a draft they are updated in place, row by row;
    // extra new ones are inserted. Only rows left over after removals are soft-cancelled, which
    // needs the record.cancel permission.
    const oldCharges = existing?.charges ?? [];
    const keptCharges =
      oldCharges.length === charges.length &&
      oldCharges.map(chargeSig).sort().join(";") === charges.map(chargeSig).sort().join(";");
    if (!keptCharges) {
      charges.forEach((c, i) => {
        if (i < oldCharges.length) c.id = oldCharges[i].id;
      });
      const reuse = charges.slice(0, oldCharges.length).map((c) => ({
        id: c.id,
        charge_type_id: c.chargeTypeId,
        amount: c.amount,
        note: c.note,
      }));
      const added = charges.slice(oldCharges.length).map((c) => ({
        id: c.id,
        charge_type_id: c.chargeTypeId,
        amount: c.amount,
        note: c.note,
      }));
      const surplus = oldCharges.slice(charges.length).map((c) => c.id);
      if (reuse.length)
        withCommit(
          tx,
          tx`update challan_charges g
                set charge_type_id = x.charge_type_id, direction = t.default_direction,
                    amount = x.amount, note = x.note
               from jsonb_to_recordset(${tx.json(reuse as never)}::jsonb)
                    as x(id uuid, charge_type_id uuid, amount numeric, note text)
               join charge_types t on t.company_id = ${companyId} and t.id = x.charge_type_id
              where g.company_id = ${companyId} and g.challan_id = ${cid} and g.id = x.id`,
        );
      if (added.length)
        withCommit(
          tx,
          tx`insert into challan_charges (id, company_id, challan_id, charge_type_id, stage, direction, amount, note)
             select x.id, ${companyId}::uuid, ${cid}::uuid, x.charge_type_id, 'hire', t.default_direction,
                    x.amount, x.note
               from jsonb_to_recordset(${tx.json(added as never)}::jsonb)
                    as x(id uuid, charge_type_id uuid, amount numeric, note text)
               join charge_types t on t.company_id = ${companyId} and t.id = x.charge_type_id`,
        );
      if (surplus.length)
        withCommit(
          tx,
          tx`update challan_charges
                set cancelled_at = now(), cancel_reason = 'Removed when the draft challan was edited'
              where company_id = ${companyId} and challan_id = ${cid} and id in ${uuidsIn(tx, surplus)}`,
        );
    }

    const saved = toChallanView(
      {
        ...row,
        challan_date: v.challanDate,
        branch_name: branch.name,
        vehicle_no: vehicle?.vehicle_no,
        driver_name: driver?.name,
        broker_name: broker?.name,
        payee_name: payeeName,
      },
      lines.map((l) => ({
        lrId: l.lrId,
        lrNo: l.lrNo,
        loadedPkgs: l.loadedPkgs,
        loadedWt: l.loadedWt,
        freightAllocated: l.freightAllocated,
      })),
      keptCharges ? oldCharges : charges,
    );
    audit(tx, companyId, "challans", cid, id ? "update" : "create", existing, saved);
    return saved;
  });
}

// ---------- register (screen 2) ----------

export type ChallanRegisterRow = {
  id: string;
  challanNo: string;
  /** yyyy-mm-dd (India) */
  challanDate: string;
  status: ChallanView["status"];
  branchName: string;
  vehicleNo: string | null;
  source: string | null;
  destination: string | null;
  payeeName: string | null;
  hirePaise: number;
  paidPaise: number;
  balancePaise: number;
  /** Whole days from unloaded to POD received, or to today while the POD is pending; null when not unloaded. */
  podAgeDays: number | null;
  podReceived: boolean;
  /** Latest trip event (by time); null when none yet. */
  latestTripEvent: { type: TripEventType; at: string } | null;
};

const REGISTER_EXPORT_MAX = 5000;

/** Filtered challan register: paid / balance come from v_challan_balance (cancelled challans aren't in it). */
export async function listChallanRegister(
  companyId: string,
  f: ChallanListFilters,
  params: { page?: number; all?: boolean },
): Promise<Page<ChallanRegisterRow>> {
  const { page, pageSize, offset } = paging(params);
  const payee = contains(f.payee);
  const vehicle = contains(f.vehicle?.replace(/\s+/g, ""));
  return withUserRead(async (tx) => {
    const where = () => tx`c.company_id = ${companyId} and c.cancelled_at is null
      ${f.from ? tx`and (c.challan_at at time zone 'Asia/Kolkata')::date >= ${f.from}::date` : tx``}
      ${f.to ? tx`and (c.challan_at at time zone 'Asia/Kolkata')::date <= ${f.to}::date` : tx``}
      ${f.branch ? tx`and c.branch_id = ${f.branch}::uuid` : tx``}
      ${f.status ? tx`and c.status = ${f.status}::challan_status` : tx``}
      ${payee ? tx`and lower(pp.name) like ${payee}` : tx``}
      ${vehicle ? tx`and lower(v.vehicle_no) like ${vehicle}` : tx``}`;
    const from = () => tx`challans c
        join v_challan_balance vb on vb.company_id = c.company_id and vb.challan_id = c.id
        join branches b on b.company_id = c.company_id and b.id = c.branch_id
        left join market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
        left join truck_parties pp on pp.company_id = c.company_id and pp.id = c.payee_party_id`;
    const [rows, [{ n }]] = await Promise.all([
      tx`select c.id, c.challan_no, (c.challan_at at time zone 'Asia/Kolkata')::date::text as challan_date,
                c.status, b.name as branch_name, v.vehicle_no, c.source, c.destination, pp.name as payee_name,
                c.hire_amount, vb.paid, vb.balance,
                case when c.unloaded_at is not null
                     then coalesce((c.pod_received_at at time zone 'Asia/Kolkata')::date,
                                   (now() at time zone 'Asia/Kolkata')::date)
                          - (c.unloaded_at at time zone 'Asia/Kolkata')::date
                end as pod_age_days,
                (c.pod_received_at is not null) as pod_received,
                te.type as trip_type, te.at as trip_at
           from ${from()}
           left join lateral (
             select t.type, t.at from trip_events t
              where t.company_id = c.company_id and t.challan_id = c.id
              order by t.at desc limit 1
           ) te on true
          where ${where()}
          order by c.challan_at desc, c.id desc
          ${params.all ? tx`limit ${REGISTER_EXPORT_MAX}` : tx`limit ${pageSize} offset ${offset}`}`,
      tx`select count(*) as n from ${from()} where ${where()}`,
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id as string,
        challanNo: r.challan_no as string,
        challanDate: r.challan_date as string,
        status: r.status as ChallanView["status"],
        branchName: r.branch_name as string,
        vehicleNo: (r.vehicle_no as string | null) ?? null,
        source: (r.source as string | null) ?? null,
        destination: (r.destination as string | null) ?? null,
        payeeName: (r.payee_name as string | null) ?? null,
        hirePaise: toPaise(r.hire_amount as string),
        paidPaise: toPaise(r.paid as string),
        balancePaise: toPaise(r.balance as string),
        podAgeDays: r.pod_age_days === null ? null : Number(r.pod_age_days),
        podReceived: !!r.pod_received,
        latestTripEvent: r.trip_type
          ? {
              type: r.trip_type as TripEventType,
              at: r.trip_at instanceof Date ? r.trip_at.toISOString() : String(r.trip_at),
            }
          : null,
      })),
      total: Number(n),
      page,
      pageSize: params.all ? REGISTER_EXPORT_MAX : pageSize,
    };
  });
}

// ---------- print (challan PDF) ----------

export type ChallanPrintExtras = {
  driverMobile: string | null;
  driverDlNo: string | null;
  vehicleTypeName: string | null;
  payeeMobile: string | null;
  payeePan: string | null;
  /** Rupees as numeric strings, from v_challan_balance. */
  money: {
    additions: string;
    deductions: string;
    grossCredit: string;
    tds: string;
    netPayable: string;
    advancePaid: string;
    paid: string;
    balance: string;
  };
};

export async function getChallanPrintExtras(
  companyId: string,
  id: string,
): Promise<ChallanPrintExtras | null> {
  if (!UUID.test(id)) return null;
  return withUserRead(async (tx) => {
    const [r] = await tx`
      select d.mobile as driver_mobile, d.dl_no, vt.name as vehicle_type_name,
             pp.mobile as payee_mobile, pp.pan as payee_pan,
             vb.additions, vb.deductions, vb.gross_credit, vb.tds_amount, vb.net_payable,
             vb.advance_paid, vb.paid, vb.balance
        from challans c
        join v_challan_balance vb on vb.company_id = c.company_id and vb.challan_id = c.id
        left join market_drivers d on d.company_id = c.company_id and d.id = c.driver_id
        left join vehicle_types vt on vt.company_id = c.company_id and vt.id = c.vehicle_type_id
        left join truck_parties pp on pp.company_id = c.company_id and pp.id = c.payee_party_id
       where c.company_id = ${companyId} and c.id = ${id}`;
    if (!r) return null;
    return {
      driverMobile: (r.driver_mobile as string | null) ?? null,
      driverDlNo: (r.dl_no as string | null) ?? null,
      vehicleTypeName: (r.vehicle_type_name as string | null) ?? null,
      payeeMobile: (r.payee_mobile as string | null) ?? null,
      payeePan: (r.payee_pan as string | null) ?? null,
      money: {
        additions: String(r.additions),
        deductions: String(r.deductions),
        grossCredit: String(r.gross_credit),
        tds: String(r.tds_amount),
        netPayable: String(r.net_payable),
        advancePaid: String(r.advance_paid),
        paid: String(r.paid),
        balance: String(r.balance),
      },
    };
  });
}

// Hire masters on the database: vehicle types, charge types, pumps, branches, number series.
import { createHash } from "node:crypto";
import type {
  Branch,
  ChargeType,
  HireNumberSeries,
  Pump,
  VehicleType,
  BaseRecord,
} from "@/lib/types";
import type {
  BranchValues,
  ChargeTypeValues,
  PumpValues,
  SeriesKey,
  SeriesCounterInput,
  SeriesValues,
  VehicleTypeValues,
} from "@/lib/validators/hire-master";
import { fail, newId, type TableName } from "../_store";
import { NotFoundError } from "../errors";
import { withUser, withUserRead, type Tx } from "./conn";
import {
  audit,
  toBranch,
  toChargeType,
  toHireNumberSeries,
  toPump,
  toVehicleType,
  type Row,
} from "./rows";
import { check, columns, insertRow, refCheck, saveRow, type Check, type Fragment } from "./write";

type Spec<V extends object, R extends BaseRecord> = {
  table: TableName;
  what: string;
  cols: Partial<Record<keyof V, string>>;
  toRecord: (r: Row) => R;
  order: (tx: Tx) => Fragment;
  /** Friendly duplicate checks (the unique indexes would only give a raw error). */
  dup: (tx: Tx, companyId: string, id: string, v: Partial<V>) => Check[];
};

/** list / insert / update for one id + version master, in the shape of db/market-drivers.ts. */
function master<V extends object, R extends BaseRecord>(spec: Spec<V, R>) {
  async function list(companyId: string): Promise<R[]> {
    return withUserRead(async (tx) => {
      const rows = await tx`select * from ${tx(spec.table)}
                             where company_id = ${companyId} and cancelled_at is null
                             order by ${spec.order(tx)}, id limit 500`;
      return rows.map(spec.toRecord);
    });
  }

  async function insert(companyId: string, v: V): Promise<R> {
    const id = newId();
    return withUser(async (tx) => {
      const r = await insertRow(
        tx,
        spec.table,
        { id, company_id: companyId, ...columns(v, spec.cols) },
        { checks: spec.dup(tx, companyId, id, v) },
      );
      const saved = spec.toRecord(r);
      audit(tx, companyId, spec.table, saved.id, "create", null, saved);
      return saved;
    });
  }

  async function update(
    companyId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<V>,
  ): Promise<R> {
    return withUser(async (tx) => {
      const { before, after } = await saveRow(
        tx,
        spec.table,
        companyId,
        id,
        expectedVersion,
        columns(patch, spec.cols),
        { what: spec.what, checks: spec.dup(tx, companyId, id, patch) },
      );
      const saved = spec.toRecord(after);
      audit(tx, companyId, spec.table, id, "update", spec.toRecord(before), saved);
      return saved;
    });
  }

  return { list, insert, update };
}

/** "<what> already exists" when another live row of the company has the same lower-cased value. */
function sameValue(
  tx: Tx,
  table: TableName,
  column: string,
  companyId: string,
  id: string,
  field: string,
  value: string | undefined,
  msg: string,
): Check[] {
  if (value === undefined) return [];
  return [
    check(
      tx,
      field,
      msg,
      tx`exists (select 1 from ${tx(table)} where company_id = ${companyId}
                   and lower(${tx(column)}) = lower(${value})
                   and cancelled_at is null and id <> ${id})`,
    ),
  ];
}

export const vehicleTypes = master<VehicleTypeValues, VehicleType>({
  table: "vehicle_types",
  what: "Vehicle type",
  cols: { name: "name", capacityKg: "capacity_kg", active: "active" },
  toRecord: toVehicleType,
  order: (tx) => tx`lower(name)`,
  dup: (tx, c, id, v) =>
    sameValue(tx, "vehicle_types", "name", c, id, "name", v.name, "A vehicle type with this name already exists"),
});

export const chargeTypes = master<ChargeTypeValues, ChargeType>({
  table: "charge_types",
  what: "Charge type",
  cols: {
    code: "code",
    label: "label",
    defaultDirection: "default_direction",
    defaultBillParty: "default_bill_party",
    stage: "stage",
    active: "active",
  },
  toRecord: toChargeType,
  order: (tx) => tx`stage, lower(code)`,
  dup: (tx, c, id, v) =>
    sameValue(tx, "charge_types", "code", c, id, "code", v.code, "A charge type with this code already exists"),
});

export const pumps = master<PumpValues, Pump>({
  table: "pumps",
  what: "Pump",
  cols: { name: "name", location: "location", ledgerRef: "ledger_ref" },
  toRecord: toPump,
  order: (tx) => tx`lower(name)`,
  dup: (tx, c, id, v) =>
    sameValue(tx, "pumps", "name", c, id, "name", v.name, "A pump with this name already exists"),
});

export const branches = master<BranchValues, Branch>({
  table: "branches",
  what: "Branch",
  cols: { name: "name", code: "code", address: "address" },
  toRecord: toBranch,
  order: (tx) => tx`lower(name)`,
  dup: (tx, c, id, v) =>
    sameValue(tx, "branches", "name", c, id, "name", v.name, "A branch with this name already exists"),
});

/** Active vehicle types for a form dropdown; the record's current type is always included. */
export async function selectVehicleTypeOptions(
  tx: Tx,
  companyId: string,
  includeId: string | null | undefined,
): Promise<{ id: string; name: string; capacityKg: number | null }[]> {
  const rows = await tx`select id, name, capacity_kg from vehicle_types
                         where company_id = ${companyId} and cancelled_at is null
                           and (active or id = ${includeId ?? null})
                         order by lower(name), id`;
  return rows.map((t) => ({
    id: t.id as string,
    name: t.name as string,
    capacityKg: (t.capacity_kg as number | null) ?? null,
  }));
}

// ---------- number series (composite key, no id / version) ----------

const branchName = (tx: Tx, a: Fragment) =>
  tx`, (select b.name from branches b where b.company_id = ${a}.company_id and b.id = ${a}.branch_id) as branch_name`;

/** audit_log.record_id is a uuid; a series has none, so use a stable one made from its key. */
function seriesAuditId(companyId: string, k: SeriesKey): string {
  const h = createHash("md5").update(`${companyId}|${k.docType}|${k.branchId}|${k.fy}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export async function listSeries(companyId: string): Promise<HireNumberSeries[]> {
  return withUserRead(async (tx) => {
    const rows = await tx`select s.*, b.name as branch_name
        from hire_number_series s
        join branches b on b.company_id = s.company_id and b.id = s.branch_id
       where s.company_id = ${companyId}
       order by s.doc_type, lower(b.name), s.fy desc limit 500`;
    return rows.map(toHireNumberSeries);
  });
}

export async function insertSeries(companyId: string, v: SeriesValues): Promise<HireNumberSeries> {
  return withUser(async (tx) => {
    const r = await insertRow(
      tx,
      "hire_number_series",
      {
        company_id: companyId,
        doc_type: v.docType,
        branch_id: v.branchId,
        fy: v.fy,
        prefix: v.prefix,
        next_no: v.nextNo,
        padding: v.padding,
      },
      {
        checks: [
          ...refCheck(tx, companyId, "branches", "branchId", "Branch", v.branchId),
          check(
            tx,
            "fy",
            "This branch already has a series of this type for that financial year",
            tx`exists (select 1 from hire_number_series where company_id = ${companyId}
                         and doc_type = ${v.docType} and branch_id = ${v.branchId} and fy = ${v.fy})`,
          ),
        ],
        extra: (a) => branchName(tx, a),
      },
    );
    const saved = toHireNumberSeries(r);
    audit(tx, companyId, "hire_number_series", seriesAuditId(companyId, v), "create", null, saved);
    return saved;
  });
}

/**
 * Edit prefix / next number / padding. The counter row is locked (number allocation locks the
 * same row), and the next number may only go up, so a number is never issued twice.
 */
export async function updateSeries(
  companyId: string,
  key: SeriesKey,
  v: SeriesCounterInput,
): Promise<HireNumberSeries> {
  return withUser(async (tx) => {
    const rows = await tx`
      with cur as (select * from hire_number_series
                    where company_id = ${companyId} and doc_type = ${key.docType}
                      and branch_id = ${key.branchId} and fy = ${key.fy} for update),
           upd as (update hire_number_series t
                      set prefix = ${v.prefix}, next_no = ${v.nextNo}, padding = ${v.padding}, updated_at = now()
                     from cur
                    where t.company_id = cur.company_id and t.doc_type = cur.doc_type
                      and t.branch_id = cur.branch_id and t.fy = cur.fy
                      and ${v.nextNo} >= cur.next_no
                    returning t.*)
      select 'before' as k, cur.* ${branchName(tx, tx`cur`)} from cur
      union all
      select 'after', upd.* ${branchName(tx, tx`upd`)} from upd`;
    const before = rows.find((r) => r.k === "before");
    const after = rows.find((r) => r.k === "after");
    if (!before) throw new NotFoundError("Number series");
    if (!after) {
      fail(
        "nextNo",
        `Next number can't go below ${before.next_no} (numbers up to it are already issued)`,
      );
    }
    const saved = toHireNumberSeries(after);
    audit(tx, companyId, "hire_number_series", seriesAuditId(companyId, key), "update", toHireNumberSeries(before), saved);
    return saved;
  });
}

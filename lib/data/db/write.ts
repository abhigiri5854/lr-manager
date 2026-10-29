// Saves for DATA_SOURCE=db, same contract as insertRecord / updateRecord / cancelRecord in
// _store.ts: NotFound, "cancelled and can't be changed", ConflictError when the version moved on,
// field errors from duplicate / reference checks.
//
// The standard (CLAUDE.md "Database performance"): ONE statement per save. The row lock, the
// checks, the versioned update and the before/after rows travel together; the audit row goes out
// with the commit (rows.ts audit → withCommit). A save is then two round trips: this statement,
// and audit + commit.
import type postgres from "postgres";
import { fail, type TableName } from "../_store";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Tx } from "./conn";
import type { Row } from "./rows";

export type Fragment = postgres.PendingQuery<postgres.Row[]>;

/**
 * A check that runs inside the save statement: a select returning rows of (field, msg) when
 * something is wrong. `whenExists` covers the usual "already saved" / "not found" cases.
 */
export type Check = Fragment;

export function check(tx: Tx, field: string, msg: string, when: Fragment): Check {
  return tx`select ${field}::text as field, ${msg}::text as msg where ${when}`;
}

export const checksSql = (tx: Tx, checks: Check[]) =>
  checks.length
    ? checks.map((c) => tx`(${c})`).reduce((a, b) => tx`${a} union all ${b}`)
    : tx`select null::text as field, null::text as msg where false`;

/** Throws the first failed check (in the order given) as a field error, like fail(). */
export function assertNoProblems(problems: { field: string; msg: string }[] | null) {
  const p = problems?.[0];
  if (p) throw new ValidationError([{ path: p.field, message: p.msg }]);
}

export type SaveOptions = {
  /** "Party", "Truck"… for NotFound and "cancelled" messages. */
  what: string;
  /** Duplicate / reference checks; any row stops the update. */
  checks?: Check[];
  /** Extra SQL condition on `cur` (the locked row) for the update to happen, e.g. not cur.is_self. */
  guard?: Fragment;
  /**
   * Runs on the locked row before the check results are reported, in the old order of the
   * mock (self-party lock, form rules on current + patch). Throwing rolls the save back.
   */
  validate?: (before: Row) => void;
  /** Extra columns for the returned rows, e.g. the driver's name on a truck: (alias) => `, …`. */
  extra?: (alias: Fragment) => Fragment;
};

/**
 * Edit at an expected version in ONE statement: lock + checks + update + before/after rows.
 * An empty `set` changes nothing (no version bump) but still checks the version.
 * expectedVersion null = whatever version is there (one-click actions such as "Invite").
 */
export async function saveRow(
  tx: Tx,
  table: TableName,
  companyId: string,
  id: string,
  expectedVersion: number | null,
  set: Row,
  opts: SaveOptions,
): Promise<{ before: Row; after: Row }> {
  const version = expectedVersion === null ? tx`true` : tx`cur.version = ${expectedVersion}`;
  const ok = tx`${version} and cur.cancelled_at is null
                and not exists (select 1 from checks) ${opts.guard ? tx`and ${opts.guard}` : tx``}`;
  const upd =
    Object.keys(set).length > 0
      ? tx`update ${tx(table)} t set ${tx(set)} from cur
            where t.company_id = cur.company_id and t.id = cur.id and ${ok} returning t.*`
      : tx`select cur.* from cur where ${ok}`;
  const extra = opts.extra ?? (() => tx``);
  const rows = await tx`
    with cur as (select * from ${tx(table)} where company_id = ${companyId} and id = ${id} for update),
         checks as (${checksSql(tx, opts.checks ?? [])}),
         upd as (${upd})
    select 'before' as k,
           (select json_agg(json_build_object('field', field, 'msg', msg)) from checks) as problems,
           cur.* ${extra(tx`cur`)}
      from cur
    union all
    select 'after', null, upd.* ${extra(tx`upd`)} from upd`;
  const before = rows.find((r) => r.k === "before");
  const after = rows.find((r) => r.k === "after");
  if (!before) throw new NotFoundError(opts.what);
  if (before.cancelled_at) fail("", `This ${opts.what.toLowerCase()} is cancelled and can't be changed`);
  if (expectedVersion !== null && before.version !== expectedVersion) throw new ConflictError();
  opts.validate?.(before);
  assertNoProblems(before.problems);
  if (!after) throw new ConflictError();
  return { before, after };
}

/**
 * Insert with its checks in one round trip: the checks and the insert are pipelined, so the
 * insert's own error (a unique index) never hides the friendly check message.
 */
export async function insertRow(
  tx: Tx,
  table: TableName,
  row: Row,
  opts: Pick<SaveOptions, "checks" | "extra"> = {},
): Promise<Row> {
  const extra = opts.extra ?? (() => tx``);
  const checks = opts.checks?.length
    ? tx`select field, msg from (${checksSql(tx, opts.checks)}) c`.execute()
    : null;
  const inserted = tx`with ins as (insert into ${tx(table)} ${tx(row)} returning *)
                      select ins.* ${extra(tx`ins`)} from ins`.execute();
  const [c, i] = await Promise.allSettled([checks ?? Promise.resolve([]), inserted]);
  if (c.status === "rejected") throw c.reason;
  assertNoProblems(c.value as { field: string; msg: string }[]);
  if (i.status === "rejected") throw i.reason;
  return i.value[0];
}

/**
 * Sets cancelled_at (+ reason) in one statement. Already cancelled → the row as it is (same as
 * the mock), with changed = false.
 */
export async function cancelRow(
  tx: Tx,
  table: TableName,
  companyId: string,
  id: string,
  what: string,
  reason?: string,
  extra?: (alias: Fragment) => Fragment,
): Promise<{ before: Row; after: Row; changed: boolean }> {
  const x = extra ?? (() => tx``);
  const rows = await tx`
    with cur as (select * from ${tx(table)} where company_id = ${companyId} and id = ${id} for update),
         upd as (update ${tx(table)} t set cancelled_at = now(), cancel_reason = ${reason ?? null}
                   from cur where t.company_id = cur.company_id and t.id = cur.id
                    and cur.cancelled_at is null returning t.*)
    select 'before' as k, cur.* ${x(tx`cur`)} from cur
    union all
    select 'after', upd.* ${x(tx`upd`)} from upd`;
  const before = rows.find((r) => r.k === "before");
  if (!before) throw new NotFoundError(what);
  const after = rows.find((r) => r.k === "after");
  return after ? { before, after, changed: true } : { before, after: before, changed: false };
}

/** Locks the row for this transaction (multi-step writes that can't be one statement). */
export async function lockRow(
  tx: Tx,
  table: TableName,
  companyId: string,
  id: string,
  what: string,
): Promise<Row> {
  const [r] = await tx`select * from ${tx(table)}
                        where company_id = ${companyId} and id = ${id} for update`;
  if (!r) throw new NotFoundError(what);
  return r;
}

/** camelCase patch → snake_case columns, only for the listed fields that are present. */
export function columns<T extends object>(
  patch: Partial<T>,
  map: Partial<Record<keyof T, string>>,
): Row {
  const out: Row = {};
  for (const [k, col] of Object.entries(map) as [keyof T, string][]) {
    if (k in patch) out[col] = (patch[k] as unknown) ?? null;
  }
  return out;
}

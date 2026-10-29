// Version-checked writes for DATA_SOURCE=db, same contract as updateRecord / cancelRecord in
// _store.ts: NotFound, "cancelled and can't be changed", ConflictError when the version moved on.
import { fail, type TableName } from "../_store";
import { ConflictError, NotFoundError } from "../errors";
import type { Tx } from "./conn";
import type { Row } from "./rows";

/** Locks the row for this transaction and checks it can still be edited at this version. */
export async function lockForUpdate(
  tx: Tx,
  table: TableName,
  companyId: string,
  id: string,
  expectedVersion: number,
  what: string,
): Promise<Row> {
  const r = await lockRow(tx, table, companyId, id, what);
  if (r.cancelled_at) fail("", `This ${what.toLowerCase()} is cancelled and can't be changed`);
  if (r.version !== expectedVersion) throw new ConflictError();
  return r;
}

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

/** UPDATE … WHERE version = $expected; 0 rows → ConflictError. Triggers bump the version. */
export async function updateVersioned(
  tx: Tx,
  table: TableName,
  companyId: string,
  id: string,
  expectedVersion: number,
  set: Row,
): Promise<Row> {
  if (Object.keys(set).length === 0) {
    const [same] = await tx`select * from ${tx(table)}
                             where company_id = ${companyId} and id = ${id} and version = ${expectedVersion}`;
    if (!same) throw new ConflictError();
    return same;
  }
  const [r] = await tx`update ${tx(table)} set ${tx(set)}
                        where company_id = ${companyId} and id = ${id} and version = ${expectedVersion}
                        returning *`;
  if (!r) throw new ConflictError();
  return r;
}

/** Sets cancelled_at (+ reason). Already cancelled → the row as it is (same as the mock). */
export async function cancelRow(
  tx: Tx,
  table: TableName,
  companyId: string,
  id: string,
  what: string,
  reason?: string,
): Promise<{ before: Row; after: Row; changed: boolean }> {
  const before = await lockRow(tx, table, companyId, id, what);
  if (before.cancelled_at) return { before, after: before, changed: false };
  const [after] = await tx`update ${tx(table)}
                            set cancelled_at = now(), cancel_reason = ${reason ?? null}
                            where company_id = ${companyId} and id = ${id} returning *`;
  return { before, after, changed: true };
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

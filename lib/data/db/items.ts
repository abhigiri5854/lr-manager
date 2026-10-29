// Item master on the database (DATA_SOURCE=db). Same behaviour as the mock half of ../items.ts.
import type { Item, Page } from "@/lib/types";
import { fail, type ListParams } from "../_store";
import { contains, paging, withUser, type Tx } from "./conn";
import { audit, toItem } from "./rows";
import { columns, lockForUpdate, updateVersioned } from "./write";

const ITEM_COLUMNS: Partial<Record<keyof Item, string>> = {
  code: "code",
  name: "name",
  hsn: "hsn",
  uom: "uom",
  gstRateBp: "gst_rate_bp",
  lastRatePaise: "last_rate_paise",
};

async function assertUniqueCode(tx: Tx, companyId: string, code: string | null, exceptId?: string) {
  if (!code) return;
  const [clash] = await tx`select 1 from items
                            where company_id = ${companyId} and lower(code) = lower(${code})
                              and cancelled_at is null and id is distinct from ${exceptId ?? null}`;
  if (clash) fail("code", `Item code ${code} is already saved`);
}

export async function listItems(companyId: string, params: ListParams): Promise<Page<Item>> {
  const { page, pageSize, offset } = paging(params);
  const q = contains(params.search);
  return withUser(async (tx) => {
    const where = () => tx`company_id = ${companyId} and cancelled_at is null
                           ${q ? tx`and search_text like ${q}` : tx``}`;
    const [rows, [{ n }]] = await Promise.all([
      tx`select * from items where ${where()} order by lower(name), id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from items where ${where()}`,
    ]);
    return { rows: rows.map(toItem), total: n as number, page, pageSize };
  });
}

/** Code-prefix matches first, then name / code contains; each group by name. */
export async function searchItems(companyId: string, q: string, limit: number): Promise<Item[]> {
  const query = q.trim().toLowerCase();
  return withUser(async (tx) => {
    if (!query) {
      const rows = await tx`select * from items where company_id = ${companyId}
                             and cancelled_at is null order by lower(name), id limit ${limit}`;
      return rows.map(toItem);
    }
    const prefix = `${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await tx`
      select *, (lower(code) like ${prefix}) as code_hit from items
       where company_id = ${companyId} and cancelled_at is null
         and (lower(code) like ${prefix} or lower(coalesce(code, '') || ' ' || name) like ${contains(query)})
       order by code_hit desc, lower(name), id
       limit ${limit}`;
    return rows.map(toItem);
  });
}

export async function getItemById(companyId: string, id: string): Promise<Item | null> {
  return withUser(async (tx) => {
    const [r] = await tx`select * from items where company_id = ${companyId} and id = ${id}`;
    return r ? toItem(r) : null;
  });
}

export async function insertItem(item: Item): Promise<Item> {
  return withUser(async (tx) => {
    await assertUniqueCode(tx, item.companyId, item.code);
    const [r] = await tx`insert into items ${tx({
      id: item.id,
      company_id: item.companyId,
      ...columns(item, ITEM_COLUMNS),
    })} returning *`;
    const saved = toItem(r);
    await audit(tx, item.companyId, "items", saved.id, "create", null, saved);
    return saved;
  });
}

export async function updateItem(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<Item>,
): Promise<Item> {
  return withUser(async (tx) => {
    const current = toItem(
      await lockForUpdate(tx, "items", companyId, id, expectedVersion, "Item"),
    );
    const next = { ...current, ...patch };
    await assertUniqueCode(tx, companyId, next.code, id);
    const saved = toItem(
      await updateVersioned(
        tx,
        "items",
        companyId,
        id,
        expectedVersion,
        columns(patch, ITEM_COLUMNS),
      ),
    );
    await audit(tx, companyId, "items", id, "update", current, saved);
    return saved;
  });
}

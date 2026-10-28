import type { Item, Page } from "@/lib/types";
import { itemFields, itemPatchSchema, type ItemInput, type ItemPatch } from "@/lib/validators/item";
import {
  clone,
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

function assertUniqueCode(companyId: string, code: string | null, exceptId?: string) {
  if (!code) return;
  if (scoped(db.items, companyId).some((i) => i.code === code && i.id !== exceptId)) {
    fail("code", `Item code ${code} is already saved`);
  }
}

const byName = (a: Item, b: Item) => a.name.localeCompare(b.name);

/** Item master, searchable by code, name or HSN. */
export async function listItems(companyId: string, params: ListParams = {}): Promise<Page<Item>> {
  const rows = scoped(db.items, companyId)
    .filter((i) => matchesSearch(params.search, i.code, i.name, i.hsn))
    .sort(byName)
    .map(clone);
  return paginate(rows, params);
}

/** Autocomplete on the invoice lines: code matches first, then name. */
export async function searchItems(companyId: string, q: string, limit = 10): Promise<Item[]> {
  const query = q.trim().toLowerCase();
  const all = scoped(db.items, companyId);
  if (!query) return all.sort(byName).slice(0, limit).map(clone);
  const codeHits = all.filter((i) => i.code?.toLowerCase().startsWith(query));
  const nameHits = all.filter((i) => !codeHits.includes(i) && matchesSearch(query, i.code, i.name));
  return [...codeHits.sort(byName), ...nameHits.sort(byName)].slice(0, limit).map(clone);
}

export async function getItemById(companyId: string, id: string): Promise<Item | null> {
  const i = findById(db.items, companyId, id);
  return i ? clone(i) : null;
}

export async function createItem(companyId: string, input: ItemInput): Promise<Item> {
  const v = parseInput(itemFields, input);
  const code = v.code ?? null;
  assertUniqueCode(companyId, code);
  const t = now();
  const item: Item = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    code,
    name: v.name,
    hsn: v.hsn ?? null,
    uom: v.uom ?? null,
    gstRateBp: v.gstRateBp ?? null,
    lastRatePaise: v.lastRatePaise ?? null,
  };
  return insertRecord("items", db.items, item);
}

export async function updateItem(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: ItemPatch,
): Promise<Item> {
  const p = parseInput(itemPatchSchema, patch);
  return updateRecord(
    "items",
    db.items,
    companyId,
    id,
    expectedVersion,
    (current) => {
      const next = { ...current, ...p };
      assertUniqueCode(companyId, next.code, id);
      return next;
    },
    "Item",
  );
}

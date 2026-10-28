"use server";

// Server actions for the item master. Role checks come with auth (Phase 4).
import { refresh } from "next/cache";
import { toActionFailure, type ActionFailure } from "@/lib/data/errors";
import { createItem, searchItems, updateItem } from "@/lib/data/items";
import { getActiveCompanyId } from "@/lib/data/session";
import type { Item } from "@/lib/types";
import type { ItemInput, ItemPatch } from "@/lib/validators/item";

/** Save an item. Without `id` it creates one; with it, updates using expectedVersion. */
export async function saveItemAction(args: {
  id?: string;
  expectedVersion?: number;
  input: ItemPatch;
}): Promise<{ ok: true; item: Item } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const item = args.id
      ? await updateItem(companyId, args.id, args.expectedVersion ?? -1, args.input)
      : await createItem(companyId, args.input as ItemInput);
    refresh();
    return { ok: true, item };
  } catch (e) {
    return toActionFailure(e);
  }
}

/** Item autocomplete by code or name. */
export async function searchItemsAction(q: string): Promise<Item[]> {
  const companyId = await getActiveCompanyId();
  return searchItems(companyId, q);
}

"use server";

// Server actions for the item master. Role checks happen in lib/data (lib/permissions.ts).
// A save hands back the saved item and doesn't re-render the page (CLAUDE.md).
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

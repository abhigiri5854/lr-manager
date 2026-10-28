import { z } from "zod";

// Item list filters as they appear in the URL (/items?q=…&page=2). Bad values are dropped.

const querySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .transform((v) => v || undefined)
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export type ItemListQuery = z.output<typeof querySchema>;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function parseItemListQuery(raw: RawParams): ItemListQuery {
  const get = (key: string) => {
    const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  return querySchema.parse({ q: get("q"), page: get("page") });
}

/** Query string for /items, leaving out page 1 and empty values. */
export function itemListSearch(query: Partial<ItemListQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

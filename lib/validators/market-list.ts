import { z } from "zod";

// Search + page for the market vehicle / driver lists (?q=…&page=2). Bad values are dropped, never an error.

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

export type MarketListQuery = z.output<typeof querySchema>;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function parseMarketListQuery(raw: RawParams): MarketListQuery {
  const get = (key: string) => {
    const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  return querySchema.parse(
    Object.fromEntries(Object.keys(querySchema.shape).map((k) => [k, get(k)])),
  );
}

export function hasMarketListFilters(query: MarketListQuery): boolean {
  return Boolean(query.q);
}

/** Query string for the list, leaving out page 1 and empty values. */
export function marketListSearch(query: Partial<MarketListQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

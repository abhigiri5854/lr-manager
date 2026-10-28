import { z } from "zod";

// /trucks filters as they appear in the URL (/trucks?q=…&tp=2&dp=1). One search box covers
// both tables; each table pages on its own. Bad values are dropped, never an error.

const pageParam = z.coerce.number().int().min(1).max(100_000).catch(1);

const querySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .transform((v) => v || undefined)
    .optional()
    .catch(undefined),
  /** Trucks page. */
  tp: pageParam,
  /** Drivers page. */
  dp: pageParam,
});

export type TruckListQuery = z.output<typeof querySchema>;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function parseTruckListQuery(raw: RawParams): TruckListQuery {
  const get = (key: string) => {
    const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  return querySchema.parse(
    Object.fromEntries(Object.keys(querySchema.shape).map((k) => [k, get(k)])),
  );
}

/** Query string for /trucks, leaving out page 1 and empty values. */
export function truckListSearch(query: Partial<TruckListQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.tp && query.tp > 1) params.set("tp", String(query.tp));
  if (query.dp && query.dp > 1) params.set("dp", String(query.dp));
  const s = params.toString();
  return s ? `?${s}` : "";
}

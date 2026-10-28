import { z } from "zod";

// POD list filters as they appear in the URL (/pod?tab=transit&q=…&overdue=1&page=2).
// Bad values are dropped, never an error.

const querySchema = z.object({
  tab: z.enum(["pending", "transit"]).catch("pending"),
  q: z
    .string()
    .trim()
    .max(100)
    .transform((v) => v || undefined)
    .optional()
    .catch(undefined),
  overdue: z.enum(["1"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export type PodListQuery = z.output<typeof querySchema>;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function parsePodListQuery(raw: RawParams): PodListQuery {
  const get = (key: string) => {
    const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  return querySchema.parse(
    Object.fromEntries(Object.keys(querySchema.shape).map((k) => [k, get(k)])),
  );
}

export function hasPodFilters(query: PodListQuery): boolean {
  return Boolean(query.q || query.overdue);
}

/** Query string for /pod, leaving out defaults (pending tab, page 1) and empty values. */
export function podListSearch(query: Partial<PodListQuery>): string {
  const params = new URLSearchParams();
  if (query.tab === "transit") params.set("tab", "transit");
  if (query.q) params.set("q", query.q);
  if (query.overdue && query.tab !== "transit") params.set("overdue", "1");
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

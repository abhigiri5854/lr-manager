import { z } from "zod";
import { isoDate, uuid } from "./common";

// Freight bill list filters as they appear in the URL
// (/bills?q=…&status=part&from=2026-10-01&to=2026-10-31&party=<id>&page=2). Bad values are dropped.

/** Draft / Final (nothing received yet) / Part-paid / Paid / Cancelled — see lib/bill-status.ts. */
export const BILL_STATUSES = ["draft", "final", "part", "paid", "cancelled"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

const optionalCatch = <T extends z.ZodType>(s: T) => s.optional().catch(undefined);

const querySchema = z.object({
  q: optionalCatch(
    z
      .string()
      .trim()
      .max(100)
      .transform((v) => v || undefined),
  ),
  status: optionalCatch(z.enum(BILL_STATUSES)),
  from: optionalCatch(isoDate),
  to: optionalCatch(isoDate),
  party: optionalCatch(uuid),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export type BillListQuery = z.output<typeof querySchema>;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function parseBillListQuery(raw: RawParams): BillListQuery {
  const get = (key: string) => {
    const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  return querySchema.parse(
    Object.fromEntries(Object.keys(querySchema.shape).map((k) => [k, get(k)])),
  );
}

export function hasBillFilters(q: BillListQuery): boolean {
  return Boolean(q.q || q.status || q.from || q.to || q.party);
}

/** Query string for /bills, leaving out page 1 and empty values. */
export function billListSearch(query: Partial<BillListQuery>): string {
  const params = new URLSearchParams();
  for (const k of ["q", "status", "from", "to", "party"] as const) {
    const v = query[k];
    if (v) params.set(k, v);
  }
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

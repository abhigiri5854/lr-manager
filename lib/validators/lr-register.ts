import { z } from "zod";
import type { LrStatus } from "@/lib/types";

// LR register filters as they appear in the URL (/lr?q=…&from=…&status=in-transit&page=2),
// so a filtered view survives refresh and can be shared. Bad values are dropped, never an error.

/** Status in the URL as a slug: "In transit" ↔ "in-transit". */
export const LR_STATUS_SLUGS: Record<string, LrStatus> = {
  draft: "Draft",
  booked: "Booked",
  "in-transit": "In transit",
  delivered: "Delivered",
  "pod-received": "POD received",
  billed: "Billed",
  paid: "Paid",
  cancelled: "Cancelled",
};

export const lrStatusSlug = (status: LrStatus): string =>
  Object.keys(LR_STATUS_SLUGS).find((k) => LR_STATUS_SLUGS[k] === status)!;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const querySchema = z.object({
  q: optional(
    z
      .string()
      .trim()
      .max(100)
      .transform((v) => v || undefined),
  ),
  from: optional(z.string().regex(ISO_DATE)),
  to: optional(z.string().regex(ISO_DATE)),
  party: optional(z.string().min(1).max(64)),
  truck: optional(z.string().min(1).max(64)),
  status: optional(z.enum(Object.keys(LR_STATUS_SLUGS) as [string, ...string[]])),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export type LrRegisterQuery = z.output<typeof querySchema>;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function parseLrRegisterQuery(raw: RawParams): LrRegisterQuery {
  const get = (key: string) => {
    const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  return querySchema.parse(
    Object.fromEntries(Object.keys(querySchema.shape).map((k) => [k, get(k)])),
  );
}

/** True when any filter (not just the page) is set. */
export function hasLrFilters(query: LrRegisterQuery): boolean {
  return Boolean(query.q || query.from || query.to || query.party || query.truck || query.status);
}

/** Query string for the register (or its export), leaving out empty values and page 1. */
export function lrRegisterSearch(query: Partial<LrRegisterQuery>): string {
  const params = new URLSearchParams();
  for (const key of ["q", "from", "to", "party", "truck", "status"] as const) {
    const v = query[key];
    if (v) params.set(key, v);
  }
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Filters in the shape lib/data/lrs expects. */
export function toLrListParams(query: LrRegisterQuery) {
  return {
    search: query.q,
    dateFrom: query.from,
    dateTo: query.to,
    partyId: query.party,
    truckId: query.truck,
    status: query.status ? LR_STATUS_SLUGS[query.status] : undefined,
    page: query.page,
  };
}

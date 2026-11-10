import { z } from "zod";

// Filters + page for the challan register (?from=…&to=…&branch=…&status=…&payee=…&vehicle=…&page=2).
// Bad values are dropped, never an error (same approach as market-list.ts).

export const CHALLAN_STATUSES = [
  "draft",
  "dispatched",
  "in_transit",
  "reached",
  "pod_received",
  "settled",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || undefined)
    .optional()
    .catch(undefined);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)))
  .optional()
  .catch(undefined);

const querySchema = z.object({
  from: isoDate,
  to: isoDate,
  branch: z.string().regex(UUID).optional().catch(undefined),
  status: z.enum(CHALLAN_STATUSES).optional().catch(undefined),
  payee: text(100),
  vehicle: text(20),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export type ChallanListQuery = z.output<typeof querySchema>;
/** The filters without the page (what the export uses). */
export type ChallanListFilters = Omit<ChallanListQuery, "page">;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function parseChallanListQuery(raw: RawParams): ChallanListQuery {
  const get = (key: string) => {
    const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  return querySchema.parse(
    Object.fromEntries(Object.keys(querySchema.shape).map((k) => [k, get(k)])),
  );
}

export function hasChallanFilters(q: ChallanListFilters): boolean {
  return Boolean(q.from || q.to || q.branch || q.status || q.payee || q.vehicle);
}

/** Query string for the register or its export, leaving out page 1 and empty values. */
export function challanListSearch(q: Partial<ChallanListQuery>): string {
  const params = new URLSearchParams();
  for (const k of ["from", "to", "branch", "status", "payee", "vehicle"] as const) {
    const v = q[k];
    if (v) params.set(k, v);
  }
  if (q.page && q.page > 1) params.set("page", String(q.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

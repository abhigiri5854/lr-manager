import { z } from "zod";
import { TRUCK_PAYMENT_MODES } from "./truck-payment";

// Filters + page for the payments list (?from=…&to=…&status=…&payee=…&mode=…&page=2).
// Bad values are dropped, never an error (same approach as challan-list.ts).

export const TRUCK_PAYMENT_STATUSES = ["draft", "pending_approval", "approved", "paid", "reversed"] as const;

const text = (max: number) =>
  z.string().trim().max(max).transform((v) => v || undefined).optional().catch(undefined);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)))
  .optional()
  .catch(undefined);

const querySchema = z.object({
  from: isoDate,
  to: isoDate,
  status: z.enum(TRUCK_PAYMENT_STATUSES).optional().catch(undefined),
  payee: text(100),
  mode: z.enum(TRUCK_PAYMENT_MODES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export type TruckPaymentListQuery = z.output<typeof querySchema>;
export type TruckPaymentListFilters = Omit<TruckPaymentListQuery, "page">;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function parseTruckPaymentListQuery(raw: RawParams): TruckPaymentListQuery {
  const get = (key: string) => {
    const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  return querySchema.parse(Object.fromEntries(Object.keys(querySchema.shape).map((k) => [k, get(k)])));
}

export function hasTruckPaymentFilters(q: TruckPaymentListFilters): boolean {
  return Boolean(q.from || q.to || q.status || q.payee || q.mode);
}

export function truckPaymentListSearch(q: Partial<TruckPaymentListQuery>): string {
  const params = new URLSearchParams();
  for (const k of ["from", "to", "status", "payee", "mode"] as const) {
    const v = q[k];
    if (v) params.set(k, v);
  }
  if (q.page && q.page > 1) params.set("page", String(q.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

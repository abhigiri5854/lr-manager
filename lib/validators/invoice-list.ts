import { z } from "zod";
import { isoDate, uuid } from "./common";

// Tax invoice list filters as they appear in the URL
// (/invoices?q=…&status=final&from=2026-10-01&to=2026-10-31&party=<id>&page=2). Bad values are dropped.

export const INVOICE_STATUSES = ["draft", "final", "cancelled"] as const;
export type InvoiceListStatus = (typeof INVOICE_STATUSES)[number];

const optionalCatch = <T extends z.ZodType>(s: T) => s.optional().catch(undefined);

const querySchema = z.object({
  q: optionalCatch(
    z
      .string()
      .trim()
      .max(100)
      .transform((v) => v || undefined),
  ),
  status: optionalCatch(z.enum(INVOICE_STATUSES)),
  from: optionalCatch(isoDate),
  to: optionalCatch(isoDate),
  party: optionalCatch(uuid),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export type InvoiceListQuery = z.output<typeof querySchema>;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function parseInvoiceListQuery(raw: RawParams): InvoiceListQuery {
  const get = (key: string) => {
    const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  return querySchema.parse(
    Object.fromEntries(Object.keys(querySchema.shape).map((k) => [k, get(k)])),
  );
}

export function hasInvoiceFilters(q: InvoiceListQuery): boolean {
  return Boolean(q.q || q.status || q.from || q.to || q.party);
}

/** Query string for /invoices, leaving out page 1 and empty values. */
export function invoiceListSearch(query: Partial<InvoiceListQuery>): string {
  const params = new URLSearchParams();
  for (const k of ["q", "status", "from", "to", "party"] as const) {
    const v = query[k];
    if (v) params.set(k, v);
  }
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

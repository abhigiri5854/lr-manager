import { z } from "zod";
import type { Action } from "@/lib/permissions";

// Tab + filters + page for /market-trucks/reports (and its Excel export). Bad values are dropped.

export const REPORT_TABS = ["hire", "pod", "tds", "margin", "lanes"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

export const REPORT_META: Record<ReportTab, { label: string; action: Action }> = {
  hire: { label: "Hire outstanding", action: "freight.view" },
  pod: { label: "POD pending ageing", action: "freight.view" },
  tds: { label: "TDS register", action: "bill.edit" },
  margin: { label: "Trip margin", action: "bill.edit" },
  lanes: { label: "Lane rates", action: "freight.view" },
};

export const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

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
  tab: z.enum(REPORT_TABS).catch("hire"),
  from: isoDate,
  to: isoDate,
  branch: z.string().regex(UUID).optional().catch(undefined),
  party: text(100),
  vehicle: text(20),
  vtype: z.string().regex(UUID).optional().catch(undefined),
  positive: z
    .literal("1")
    .transform(() => true)
    .optional()
    .catch(undefined),
  fy: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional()
    .catch(undefined),
  quarter: z.enum(QUARTERS).optional().catch(undefined),
  basis: z.enum(["trip", "per_tonne"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export type ReportQuery = z.output<typeof querySchema>;
export type ReportFilters = Omit<ReportQuery, "page" | "tab">;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function parseReportQuery(raw: RawParams): ReportQuery {
  const get = (key: string) => {
    const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  return querySchema.parse(
    Object.fromEntries(Object.keys(querySchema.shape).map((k) => [k, get(k)])),
  );
}

/** Query string for the page or its export; empty values and page 1 are left out. */
export function reportSearch(tab: ReportTab, f: ReportFilters, page?: number): string {
  const params = new URLSearchParams({ tab });
  for (const k of ["from", "to", "branch", "party", "vehicle", "vtype", "fy", "quarter", "basis"] as const) {
    const v = f[k];
    if (v) params.set(k, v);
  }
  if (f.positive) params.set("positive", "1");
  if (page && page > 1) params.set("page", String(page));
  return `?${params.toString()}`;
}

/** Current Indian financial year start year → "2026-27". */
export const fyLabel = (startYear: number) =>
  `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

/** The current FY and the four before it, newest first. `todayIso` = yyyy-mm-dd. */
export function fyOptions(todayIso: string): string[] {
  const [y, m] = todayIso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return [0, 1, 2, 3, 4].map((i) => fyLabel(start - i));
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { DateField } from "@/components/ui/DateField";
import { Field, Select } from "@/components/ui/Field";
import { partyLabel } from "@/lib/self-party";
import {
  INVOICE_STATUSES,
  invoiceListSearch,
  type InvoiceListQuery,
} from "@/lib/validators/invoice-list";
import { invoiceStatusLabel } from "./InvoiceStatusChip";

export type InvoicePartyOption = {
  id: string;
  name: string;
  place: string | null;
  isSelf?: boolean;
};

type Filters = Required<{ [K in "q" | "from" | "to" | "party" | "status"]: string }>;

const toFilters = (q: Partial<InvoiceListQuery>): Filters => ({
  q: q.q ?? "",
  from: q.from ?? "",
  to: q.to ?? "",
  party: q.party ?? "",
  status: q.status ?? "",
});

const SEARCH_DELAY_MS = 350;

/**
 * Search, status, date range and party for /invoices. Every change goes into the URL (page resets
 * to 1); the server filters. Without JavaScript the form still works as a plain GET.
 */
export function InvoiceFilters({
  query,
  parties,
  disabled,
}: {
  query: Partial<InvoiceListQuery>;
  parties: InvoicePartyOption[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const serverKey = invoiceListSearch({ ...query, page: 1 });

  const [filters, setFilters] = useState(() => toFilters(query));
  // Back/forward or a shared link changes the URL from outside: show its filters. URLs this
  // form pushed itself are skipped so a half-typed search isn't overwritten.
  const [syncedKey, setSyncedKey] = useState(serverKey);
  const [pushedKey, setPushedKey] = useState<string | null>(null);
  if (serverKey !== syncedKey) {
    setSyncedKey(serverKey);
    if (serverKey !== pushedKey) setFilters(toFilters(query));
  }

  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  function go(next: Filters, mode: "push" | "replace") {
    clearTimeout(searchTimer.current);
    const search = invoiceListSearch({
      ...next,
      status: (next.status || undefined) as InvoiceListQuery["status"],
    });
    if (search === serverKey) return;
    setPushedKey(search);
    startTransition(() => router[mode](`${pathname}${search}`, { scroll: false }));
  }

  function changeDate(key: "from" | "to", value: string) {
    if (value === filters[key]) return;
    const next = { ...filters, [key]: value };
    setFilters(next);
    go(next, "push");
  }

  function change(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const key = e.target.name as keyof Filters;
    const next = { ...filters, [key]: e.target.value };
    setFilters(next);
    clearTimeout(searchTimer.current);
    if (key === "q") {
      searchTimer.current = setTimeout(() => go(next, "replace"), SEARCH_DELAY_MS);
    } else {
      go(next, "push");
    }
  }

  const names = new Map<string, number>();
  parties.forEach((p) => names.set(p.name, (names.get(p.name) ?? 0) + 1));

  return (
    <form
      action={pathname}
      method="get"
      role="search"
      aria-label="Filter invoices"
      aria-busy={isPending || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        go(filters, "push");
      }}
      className="@container rounded-card border border-border bg-surface p-5"
    >
      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @4xl:grid-cols-[minmax(0,1.2fr)_minmax(0,2.2fr)_repeat(2,minmax(0,1fr))]">
        <Field
          label="Search"
          name="q"
          type="search"
          placeholder="Invoice no., party or GSTIN"
          value={filters.q}
          onChange={change}
          disabled={disabled}
          autoComplete="off"
        />

        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-1.5 p-0 text-[13px] font-semibold text-label">Date range</legend>
          <div className="flex flex-wrap items-center gap-2">
            <DateField
              label="From date"
              hideLabel
              name="from"
              value={filters.from}
              onChange={(from) => changeDate("from", from)}
              disabled={disabled}
              className="min-w-36 flex-1"
            />
            <span aria-hidden className="hidden text-muted @sm:inline">
              –
            </span>
            <DateField
              label="To date"
              hideLabel
              name="to"
              value={filters.to}
              warning={
                filters.from && filters.to && filters.to < filters.from
                  ? "Before the from date — nothing will match"
                  : undefined
              }
              onChange={(to) => changeDate("to", to)}
              disabled={disabled}
              className="min-w-36 flex-1"
            />
          </div>
        </fieldset>

        <Select
          label="Party"
          name="party"
          value={filters.party}
          onChange={change}
          disabled={disabled}
        >
          <option value="">All parties</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.isSelf
                ? partyLabel(p)
                : names.get(p.name)! > 1 && p.place
                  ? `${p.name} · ${p.place}`
                  : p.name}
            </option>
          ))}
        </Select>

        <Select
          label="Status"
          name="status"
          value={filters.status}
          onChange={change}
          disabled={disabled}
        >
          <option value="">All</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {invoiceStatusLabel[s]}
            </option>
          ))}
        </Select>
      </div>
      <button type="submit" className="sr-only" tabIndex={-1}>
        Apply filters
      </button>
    </form>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { DateField } from "@/components/ui/DateField";
import { Field, Select } from "@/components/ui/Field";
import type { LrStatus } from "@/lib/types";
import {
  LR_STATUS_SLUGS,
  lrRegisterSearch,
  type LrRegisterQuery,
} from "@/lib/validators/lr-register";

export type PartyOption = { id: string; name: string; place: string | null };
export type TruckOption = { id: string; number: string };

type Filters = Required<{ [K in "q" | "from" | "to" | "party" | "truck" | "status"]: string }>;

const toFilters = (q: Partial<LrRegisterQuery>): Filters => ({
  q: q.q ?? "",
  from: q.from ?? "",
  to: q.to ?? "",
  party: q.party ?? "",
  truck: q.truck ?? "",
  status: q.status ?? "",
});

const SEARCH_DELAY_MS = 350;

/**
 * Search, date range, party, truck and status for the LR register. Every change goes into
 * the URL (page resets to 1); the server reads it and filters. Without JavaScript the form
 * still works as a plain GET.
 */
export function RegisterFilters({
  query,
  parties,
  trucks,
  disabled,
}: {
  query: Partial<LrRegisterQuery>;
  parties: PartyOption[];
  trucks: TruckOption[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const serverKey = lrRegisterSearch({ ...query, page: 1 });

  const [filters, setFilters] = useState(() => toFilters(query));
  // When the URL changes from outside (back/forward, a shared link), show its filters.
  // URLs this form pushed itself are skipped so a half-typed search isn't overwritten.
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
    const search = lrRegisterSearch(next);
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
      // Wait for a pause in typing; replace so each keystroke isn't a history entry.
      searchTimer.current = setTimeout(() => go(next, "replace"), SEARCH_DELAY_MS);
    } else {
      go(next, "push");
    }
  }

  // Party names can repeat (parties are unique by GSTIN); show which is which.
  const names = new Map<string, number>();
  parties.forEach((p) => names.set(p.name, (names.get(p.name) ?? 0) + 1));

  return (
    <form
      action={pathname}
      method="get"
      role="search"
      aria-label="Filter LRs"
      aria-busy={isPending || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        go(filters, "push");
      }}
      className="@container rounded-card border border-border bg-surface p-5"
    >
      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)_repeat(3,minmax(0,1fr))]">
        <Field
          label="Search"
          name="q"
          type="search"
          placeholder="LR, invoice, e-way, truck"
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
              max={filters.to || undefined}
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
              min={filters.from || undefined}
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
              {names.get(p.name)! > 1 && p.place ? `${p.name} · ${p.place}` : p.name}
            </option>
          ))}
        </Select>

        <Select
          label="Truck"
          name="truck"
          value={filters.truck}
          onChange={change}
          disabled={disabled}
        >
          <option value="">All trucks</option>
          {trucks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.number}
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
          {Object.entries(LR_STATUS_SLUGS).map(([slug, status]: [string, LrStatus]) => (
            <option key={slug} value={slug}>
              {status}
            </option>
          ))}
        </Select>
      </div>
      {/* Enter in the search box submits; hidden because every other change applies at once. */}
      <button type="submit" className="sr-only" tabIndex={-1}>
        Apply filters
      </button>
    </form>
  );
}

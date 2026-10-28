"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { Field } from "@/components/ui/Field";
import { truckListSearch, type TruckListQuery } from "@/lib/validators/truck-list";

const SEARCH_DELAY_MS = 350;

/**
 * Search box for /trucks (truck number, driver name / mobile, licence). Changes go into the URL
 * with both tables back on page 1; without JavaScript the form still works as a plain GET.
 */
export function TruckFilters({
  query,
  disabled,
}: {
  query: Partial<TruckListQuery>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const serverKey = truckListSearch({ q: query.q });

  const [q, setQ] = useState(query.q ?? "");
  // When the URL changes from outside (back/forward, an "Open it" link), show its search;
  // URLs this form pushed itself are skipped so a half-typed search isn't overwritten.
  const [syncedKey, setSyncedKey] = useState(serverKey);
  const [pushedKey, setPushedKey] = useState<string | null>(null);
  if (serverKey !== syncedKey) {
    setSyncedKey(serverKey);
    if (serverKey !== pushedKey) setQ(query.q ?? "");
  }

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function go(next: string, mode: "push" | "replace") {
    clearTimeout(timer.current);
    const search = truckListSearch({ q: next.trim() || undefined });
    if (search === serverKey && !query.tp && !query.dp) return;
    setPushedKey(search);
    startTransition(() => router[mode](`${pathname}${search}`, { scroll: false }));
  }

  function onSearch(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setQ(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => go(value, "replace"), SEARCH_DELAY_MS);
  }

  return (
    <form
      action={pathname}
      method="get"
      role="search"
      aria-label="Search trucks and drivers"
      aria-busy={isPending || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        go(q, "push");
      }}
      className="rounded-card border border-border bg-surface p-5"
    >
      <Field
        label="Search"
        name="q"
        type="search"
        placeholder="Truck number, driver name, mobile or licence"
        value={q}
        onChange={onSearch}
        disabled={disabled}
        autoComplete="off"
      />
      <button type="submit" className="sr-only" tabIndex={-1}>
        Search
      </button>
    </form>
  );
}

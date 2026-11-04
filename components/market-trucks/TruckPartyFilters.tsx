"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { Field } from "@/components/ui/Field";
import { truckPartyListSearch, type TruckPartyListQuery } from "@/lib/validators/truck-party-list";

const SEARCH_DELAY_MS = 350;

/** Search box for /market-trucks/parties. Changes go into the URL with the page reset to 1. */
export function TruckPartyFilters({
  query,
  disabled,
}: {
  query: Partial<TruckPartyListQuery>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const serverKey = truckPartyListSearch({ ...query, page: 1 });

  const [q, setQ] = useState(query.q ?? "");
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
    const search = truckPartyListSearch({ q: next.trim() || undefined });
    if (search === serverKey) return;
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
      aria-label="Search truck parties"
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
        placeholder="Name, mobile or PAN"
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

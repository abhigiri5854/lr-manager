"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { Field } from "@/components/ui/Field";
import { itemListSearch, type ItemListQuery } from "@/lib/validators/item-list";

const SEARCH_DELAY_MS = 350;

/**
 * Search box for /items. Changes go into the URL with the page reset to 1; without
 * JavaScript the form still works as a plain GET.
 */
export function ItemFilters({
  query,
  disabled,
}: {
  query: Partial<ItemListQuery>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const serverKey = itemListSearch({ ...query, page: 1 });

  const [q, setQ] = useState(query.q ?? "");
  // When the URL changes from outside (back/forward), show its search; URLs this form
  // pushed itself are skipped so a half-typed search isn't overwritten.
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
    const search = itemListSearch({ q: next.trim() || undefined });
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
      aria-label="Search items"
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
        placeholder="Item code, name or HSN"
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

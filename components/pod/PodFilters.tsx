"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { Field } from "@/components/ui/Field";
import { podListSearch, type PodListQuery } from "@/lib/validators/pod-list";

const SEARCH_DELAY_MS = 350;

/**
 * Search (and, on the pending tab, "Overdue only") for /pod. Changes go into the URL with the
 * page reset to 1; without JavaScript the form still works as a plain GET.
 */
export function PodFilters({
  query,
  disabled,
}: {
  query: Partial<PodListQuery>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const tab = query.tab ?? "pending";
  const serverKey = podListSearch({ ...query, page: 1 });

  const [q, setQ] = useState(query.q ?? "");
  // When the URL changes from outside (back/forward), show its filters; URLs this form
  // pushed itself are skipped so a half-typed search isn't overwritten.
  const [syncedKey, setSyncedKey] = useState(serverKey);
  const [pushedKey, setPushedKey] = useState<string | null>(null);
  if (serverKey !== syncedKey) {
    setSyncedKey(serverKey);
    if (serverKey !== pushedKey) setQ(query.q ?? "");
  }

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function go(nextQ: string, overdue: boolean, mode: "push" | "replace") {
    clearTimeout(timer.current);
    const search = podListSearch({
      tab,
      q: nextQ.trim() || undefined,
      overdue: overdue ? "1" : undefined,
    });
    if (search === serverKey) return;
    setPushedKey(search);
    startTransition(() => router[mode](`${pathname}${search}`, { scroll: false }));
  }

  function onSearch(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setQ(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => go(value, query.overdue === "1", "replace"), SEARCH_DELAY_MS);
  }

  return (
    <form
      action={pathname}
      method="get"
      role="search"
      aria-label="Filter LRs"
      aria-busy={isPending || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        go(q, query.overdue === "1", "push");
      }}
      className="flex flex-wrap items-end gap-4 rounded-card border border-border bg-surface p-5"
    >
      {tab === "transit" && <input type="hidden" name="tab" value="transit" />}
      <Field
        label="Search"
        name="q"
        type="search"
        placeholder="LR no or consignee"
        value={q}
        onChange={onSearch}
        disabled={disabled}
        autoComplete="off"
        className="min-w-60 flex-1"
      />
      {tab === "pending" && (
        <label className="flex h-control cursor-pointer items-center gap-2 text-sm font-semibold text-label">
          <input
            type="checkbox"
            name="overdue"
            value="1"
            checked={query.overdue === "1"}
            onChange={(e) => go(q, e.target.checked, "push")}
            disabled={disabled}
            className="h-5 w-5"
          />
          Overdue only
        </label>
      )}
      <button type="submit" className="sr-only" tabIndex={-1}>
        Apply filters
      </button>
    </form>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { Field, Select } from "@/components/ui/Field";
import {
  CHALLAN_STATUSES,
  challanListSearch,
  hasChallanFilters,
  type ChallanListFilters,
} from "@/lib/validators/challan-list";

/** Filter bar of the challan register. Submitting puts the filters in the URL with the page back at 1. */
export function ChallanFilters({
  filters,
  branches,
  disabled,
}: {
  filters: ChallanListFilters;
  branches: { id: string; name: string }[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const get = (k: string) => String(d.get(k) ?? "").trim() || undefined;
    const search = challanListSearch({
      from: from || undefined,
      to: to || undefined,
      branch: get("branch"),
      status: get("status") as ChallanListFilters["status"],
      payee: get("payee"),
      vehicle: get("vehicle"),
    });
    startTransition(() => router.push(`${pathname}${search}`, { scroll: false }));
  }

  return (
    <form
      onSubmit={onSubmit}
      role="search"
      aria-label="Filter challans"
      aria-busy={isPending || undefined}
      className="rounded-card border border-border bg-surface p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DateField label="From date" name="from" value={from} onChange={setFrom} disabled={disabled} />
        <DateField label="To date" name="to" value={to} onChange={setTo} disabled={disabled} />
        <Select label="Branch" name="branch" defaultValue={filters.branch ?? ""} disabled={disabled}>
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select label="Status" name="status" defaultValue={filters.status ?? ""} disabled={disabled}>
          <option value="">All statuses</option>
          {CHALLAN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </Select>
        <Field
          label="Payee"
          name="payee"
          placeholder="Owner or broker name"
          defaultValue={filters.payee ?? ""}
          disabled={disabled}
          autoComplete="off"
        />
        <Field
          label="Vehicle no."
          name="vehicle"
          placeholder="e.g. BR01GN8331"
          defaultValue={filters.vehicle ?? ""}
          disabled={disabled}
          autoComplete="off"
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit" disabled={disabled}>
          Apply filters
        </Button>
        {hasChallanFilters(filters) && (
          <Button href="/market-trucks/challans" variant="secondary">
            Clear filters
          </Button>
        )}
      </div>
    </form>
  );
}

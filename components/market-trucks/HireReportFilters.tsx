"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { Field, Select } from "@/components/ui/Field";
import {
  QUARTERS,
  reportSearch,
  type ReportFilters,
  type ReportTab,
} from "@/lib/validators/hire-report";

type Opt = { id: string; name: string };

/** Filter bar of the hire reports; the fields depend on the tab. Submitting puts them in the URL, page 1. */
export function HireReportFilters({
  tab,
  filters,
  branches,
  vehicleTypes,
  fys,
}: {
  tab: ReportTab;
  filters: ReportFilters;
  branches: Opt[];
  vehicleTypes: Opt[];
  fys: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");

  const showDates = tab === "margin" || tab === "lanes";
  const showBranch = tab !== "tds" && tab !== "lanes";
  const showParty = tab === "hire" || tab === "pod" || tab === "tds";

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const get = (k: string) => String(d.get(k) ?? "").trim() || undefined;
    const search = reportSearch(tab, {
      from: showDates ? from || undefined : undefined,
      to: showDates ? to || undefined : undefined,
      branch: get("branch"),
      party: get("party"),
      vehicle: get("vehicle"),
      vtype: get("vtype"),
      positive: d.get("positive") ? true : undefined,
      fy: get("fy"),
      quarter: get("quarter") as ReportFilters["quarter"],
      basis: get("basis") as ReportFilters["basis"],
    });
    startTransition(() => router.push(`${pathname}${search}`, { scroll: false }));
  }

  return (
    <form
      onSubmit={onSubmit}
      role="search"
      aria-label="Filter report"
      aria-busy={isPending || undefined}
      className="rounded-card border border-border bg-surface p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {showDates && (
          <>
            <DateField label="From date" name="from" value={from} onChange={setFrom} />
            <DateField label="To date" name="to" value={to} onChange={setTo} />
          </>
        )}
        {tab === "tds" && (
          <>
            <Select label="Financial year" name="fy" defaultValue={filters.fy ?? fys[0]}>
              {fys.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <Select label="Quarter" name="quarter" defaultValue={filters.quarter ?? ""}>
              <option value="">All quarters</option>
              {QUARTERS.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </Select>
          </>
        )}
        {showBranch && (
          <Select label="Branch" name="branch" defaultValue={filters.branch ?? ""}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        {tab === "margin" && (
          <Select label="Vehicle type" name="vtype" defaultValue={filters.vtype ?? ""}>
            <option value="">All vehicle types</option>
            {vehicleTypes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        )}
        {tab === "lanes" && (
          <Select label="Rate basis" name="basis" defaultValue={filters.basis ?? ""}>
            <option value="">All rate bases</option>
            <option value="trip">Per trip</option>
            <option value="per_tonne">Per tonne</option>
          </Select>
        )}
        {showParty && (
          <Field
            label="Party"
            name="party"
            placeholder="Owner or broker name"
            defaultValue={filters.party ?? ""}
            autoComplete="off"
          />
        )}
        {tab === "pod" && (
          <Field
            label="Vehicle no."
            name="vehicle"
            placeholder="e.g. BR01GN8331"
            defaultValue={filters.vehicle ?? ""}
            autoComplete="off"
          />
        )}
        {tab === "hire" && (
          <label className="flex min-h-11 items-center gap-2 self-end text-sm text-text">
            <input type="checkbox" name="positive" defaultChecked={!!filters.positive} className="size-4" />
            Balance &gt; 0 only
          </label>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit">Apply filters</Button>
        <Button href={`${pathname}?tab=${tab}`} variant="secondary">
          Clear filters
        </Button>
      </div>
    </form>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { Field, Select } from "@/components/ui/Field";
import { TRUCK_PAYMENT_MODES } from "@/lib/validators/truck-payment";
import {
  TRUCK_PAYMENT_STATUSES,
  hasTruckPaymentFilters,
  truckPaymentListSearch,
  type TruckPaymentListFilters,
} from "@/lib/validators/truck-payment-list";
import { paymentModeLabel, paymentStatusLabel } from "./labels";

/** Filter bar of the payments list. Submitting puts the filters in the URL with the page back at 1. */
export function PaymentFilters({
  filters,
  disabled,
}: {
  filters: TruckPaymentListFilters;
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
    const search = truckPaymentListSearch({
      from: from || undefined,
      to: to || undefined,
      status: get("status") as TruckPaymentListFilters["status"],
      mode: get("mode") as TruckPaymentListFilters["mode"],
      payee: get("payee"),
    });
    startTransition(() => router.push(`${pathname}${search}`, { scroll: false }));
  }

  return (
    <form
      onSubmit={onSubmit}
      role="search"
      aria-label="Filter payments"
      aria-busy={isPending || undefined}
      className="rounded-card border border-border bg-surface p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DateField label="From date" name="from" value={from} onChange={setFrom} disabled={disabled} />
        <DateField label="To date" name="to" value={to} onChange={setTo} disabled={disabled} />
        <Select label="Status" name="status" defaultValue={filters.status ?? ""} disabled={disabled}>
          <option value="">All statuses</option>
          {TRUCK_PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {paymentStatusLabel[s]}
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
        <Select label="Mode" name="mode" defaultValue={filters.mode ?? ""} disabled={disabled}>
          <option value="">All modes</option>
          {TRUCK_PAYMENT_MODES.map((m) => (
            <option key={m} value={m}>
              {paymentModeLabel[m]}
            </option>
          ))}
        </Select>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit" disabled={disabled}>
          Apply filters
        </Button>
        {hasTruckPaymentFilters(filters) && (
          <Button href="/market-trucks/payments" variant="secondary">
            Clear filters
          </Button>
        )}
      </div>
    </form>
  );
}

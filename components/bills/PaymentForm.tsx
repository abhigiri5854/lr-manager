"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadOpenBillsAction,
  savePaymentAction,
} from "@/app/(app)/bills/actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { DateField, focusFirstInvalidDate } from "@/components/ui/DateField";
import { Field, Select } from "@/components/ui/Field";
import type { OpenBill } from "@/lib/data/bills";
import { formatDate, formatPaise, formatRupees } from "@/lib/format";
import { todayInIndia } from "@/lib/fy";
import {
  allocateOldestFirst,
  formToPaymentInput,
  paymentErrorKey,
  paymentTotals,
  RECEIPT_MODES,
  type PaymentFormErrors,
  type PaymentFormValues,
} from "@/lib/payment-form";
import type { Payment, ReceiptMode } from "@/lib/types";

export type PaymentPartyOption = { id: string; name: string; place: string | null };

const money = (paise: number) => (paise ? formatPaise(paise) : "");

function initialValues(
  payment: Payment | null | undefined,
  partyId: string | undefined,
): PaymentFormValues {
  return {
    partyId: payment?.partyId ?? partyId ?? "",
    amount: payment ? money(payment.amountPaise) : "",
    tds: payment ? money(payment.tdsPaise) : "",
    mode: payment?.mode ?? "neft_upi",
    receivedOn: payment?.receivedOn ?? todayInIndia(),
    reference: payment?.reference ?? "",
    alloc: Object.fromEntries(
      (payment?.allocations ?? []).map((a) => [a.freightBillId, formatPaise(a.amountPaise)]),
    ),
  };
}

/**
 * Record a payment, or change one (re-allocate its on-account part). Amount + TDS are spread over
 * the party's open bills oldest first; every amount stays editable, and what isn't allocated is
 * kept on account for later.
 */
export function PaymentForm({
  parties,
  partyId,
  billId,
  payment,
  onDone,
  onCancel,
}: {
  parties: PaymentPartyOption[];
  /** Start with this party picked. */
  partyId?: string;
  /** Allocate to this bill first (the row's "Record payment"). */
  billId?: string;
  /** Editing this payment instead of recording a new one. */
  payment?: Payment | null;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState(() => initialValues(payment, partyId));
  const [errors, setErrors] = useState<PaymentFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<OpenBill[] | null>(null);
  // Once someone types an allocation, amounts stop re-spreading automatically.
  const [touched, setTouched] = useState(!!payment);
  const [pending, startTransition] = useTransition();
  const [loading, startLoading] = useTransition();

  const editing = !!payment;
  const sorted = (bills: OpenBill[]) =>
    billId ? [...bills].sort((a, b) => Number(b.id === billId) - Number(a.id === billId)) : bills;
  const bills = open ? sorted(open) : [];
  const totals = paymentTotals(values);

  function spread(v: PaymentFormValues, list: OpenBill[]): PaymentFormValues {
    const split = allocateOldestFirst(sorted(list), paymentTotals(v).totalPaise);
    return {
      ...v,
      alloc: Object.fromEntries(Object.entries(split).map(([id, p]) => [id, formatPaise(p)])),
    };
  }

  function loadBills(forParty: string, base: PaymentFormValues) {
    if (!forParty) {
      setOpen([]);
      return;
    }
    startLoading(async () => {
      const list = await loadOpenBillsAction(forParty, payment?.id);
      setOpen(list);
      if (!touched) setValues(spread({ ...base, partyId: forParty }, list));
    });
  }

 useEffect(() => {
  if (!values.partyId) return;

  const timer = setTimeout(() => {
    loadBills(values.partyId, values);
  }, 0);

  return () => clearTimeout(timer);

  // Only for the party the form starts with; later changes go through changeParty.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  function changeParty(id: string) {
    const next = { ...values, partyId: id, alloc: {} };
    setValues(next);
    setOpen(null);
    setTouched(false);
    loadBills(id, next);
  }

  function changeMoney(key: "amount" | "tds", text: string) {
    const next = { ...values, [key]: text };
    setValues(!touched && open ? spread(next, open) : next);
  }

  function submit() {
    if (focusFirstInvalidDate()) return;
    const due = Object.fromEntries((open ?? []).map((b) => [b.id, b.duePaise]));
    const built = formToPaymentInput(values, due);
    if (!built.ok) {
      setErrors(built.errors);
      setFormError("Check the highlighted fields.");
      return;
    }
    startTransition(async () => {
      const r = await savePaymentAction({
        id: payment?.id,
        expectedVersion: payment?.version,
        input: built.input,
      });
      if (r.ok) {
        setErrors({});
        setFormError(null);
        setConflict(false);
        if (onDone) return onDone();
        // Inline card: clear it for the next payment.
        setValues(initialValues(null, undefined));
        setOpen([]);
        setTouched(false);
        setSaved(true);
        return;
      }
      if (r.kind === "conflict") setConflict(true);
      else if (r.kind === "validation") {
        const ids = (built.input.allocations ?? []).map((a) => a.freightBillId);
        setErrors(
          Object.fromEntries(
            r.issues.filter((i) => i.path).map((i) => [paymentErrorKey(i.path, ids), i.message]),
          ),
        );
        setFormError(r.message);
      } else setFormError(r.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {conflict && (
        <Alert
          tone="info"
          title="Not saved — this payment was changed by someone else since you opened it."
        >
          Close this and open it again to see the latest version.
        </Alert>
      )}
      {saved && (
        <div role="status" className="rounded-tile bg-success-soft px-4 py-3 text-sm text-success">
          <b>Payment saved.</b>
        </div>
      )}
      {formError && !conflict && (
        <div role="alert" className="text-sm text-danger">
          {formError}
        </div>
      )}

      <Select
        label="Party"
        value={values.partyId}
        onChange={(e) => changeParty(e.target.value)}
        error={errors.partyId}
        disabled={editing}
      >
        <option value="">Select party…</option>
        {parties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.place ? `${p.name} · ${p.place}` : p.name}
          </option>
        ))}
      </Select>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Amount ₹"
          inputMode="decimal"
          placeholder="0.00"
          value={values.amount}
          onChange={(e) => changeMoney("amount", e.target.value)}
          error={errors.amount}
        />
        <Field
          label="TDS ₹"
          inputMode="decimal"
          placeholder="0.00"
          value={values.tds}
          onChange={(e) => changeMoney("tds", e.target.value)}
          error={errors.tds}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Mode"
          value={values.mode}
          onChange={(e) => setValues({ ...values, mode: e.target.value as ReceiptMode })}
        >
          {RECEIPT_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
        <DateField
          label="Date"
          value={values.receivedOn}
          onChange={(receivedOn) => setValues({ ...values, receivedOn })}
          error={errors.receivedOn}
        />
      </div>

      <Field
        label="Reference"
        placeholder="UTR / cheque no."
        value={values.reference}
        onChange={(e) => setValues({ ...values, reference: e.target.value })}
        maxLength={100}
        error={errors.reference}
      />

      <fieldset className="m-0 min-w-0 rounded-control border border-border p-3">
        <legend className="px-1 text-[13px] font-semibold text-label">Against bills</legend>
        {!values.partyId ? (
          <p className="m-0 text-sm text-muted">Pick a party to see its open bills.</p>
        ) : open === null || loading ? (
          <p className="m-0 text-sm text-muted">Loading bills…</p>
        ) : bills.length === 0 ? (
          <p className="m-0 text-sm text-muted">
            — no open bills — the whole amount is kept on account.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {bills.map((b) => (
              <li key={b.id} className="grid grid-cols-[1fr_8.5rem] items-start gap-3">
                <div className="min-w-0 pt-2.5 text-sm">
                  <b className="font-mono">{b.billNo}</b>{" "}
                  <span className="text-muted">
                    · {formatDate(b.billDate)} · due {formatRupees(b.duePaise)}
                  </span>
                </div>
                <Field
                  label={`Allocate to ${b.billNo}`}
                  hideLabel
                  inputMode="decimal"
                  placeholder="0.00"
                  value={values.alloc[b.id] ?? ""}
                  onChange={(e) => {
                    setTouched(true);
                    setValues({ ...values, alloc: { ...values.alloc, [b.id]: e.target.value } });
                  }}
                  error={errors[`alloc.${b.id}`]}
                />
              </li>
            ))}
          </ul>
        )}
        {errors.alloc && <div className="mt-2 text-[13px] text-danger">{errors.alloc}</div>}
        {totals.totalPaise > 0 && (
          <p className="mt-3 mb-0 text-[13px] text-muted">
            Allocated {formatRupees(totals.allocatedPaise)} · On account{" "}
            <b className={totals.onAccountPaise < 0 ? "text-danger" : "text-text"}>
              {formatRupees(totals.onAccountPaise)}
            </b>
            {totals.onAccountPaise > 0 && " (can be allocated to a later bill)"}
          </p>
        )}
      </fieldset>

      <div className="flex flex-wrap justify-end gap-3">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Close
          </Button>
        )}
        <Button variant="dark" onClick={submit} disabled={pending || conflict}>
          {pending ? "Saving…" : editing ? "Save changes" : "Save payment"}
        </Button>
      </div>
    </div>
  );
}

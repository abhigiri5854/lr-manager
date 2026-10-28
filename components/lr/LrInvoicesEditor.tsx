"use client";

import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { formatRupees } from "@/lib/format";
import {
  emptyInvoiceRow,
  invoicesTotalPaise,
  needsEwayBill,
  tidyRupees,
  type FormErrors,
  type InvoiceDuplicates,
  type LrInvoiceRow,
} from "@/lib/lr-form";

const smallButton =
  "min-h-9 cursor-pointer rounded-control border border-border-input bg-surface px-3 text-sm font-semibold text-text";

/**
 * Goods invoices carried on the LR (lrInvoices): invoice no., date, value, e-way bill no. and
 * expiry per row, with Remove and "+ Add invoice". Renders inside the "Vehicle & documents" grid.
 */
export function LrInvoicesEditor({
  rows,
  onChange,
  errors,
  duplicates,
  onInvoiceNoBlur,
  onDismissDuplicate,
}: {
  rows: LrInvoiceRow[];
  onChange: (rows: LrInvoiceRow[]) => void;
  errors: FormErrors;
  /** Other LRs already carrying a row's invoice no., by row key. */
  duplicates: InvoiceDuplicates;
  onInvoiceNoBlur: (row: LrInvoiceRow) => void;
  onDismissDuplicate: (rowKey: string) => void;
}) {
  const update = (key: string, patch: Partial<LrInvoiceRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = invoicesTotalPaise(rows);

  return (
    <>
      {rows.map((r, i) => {
        const err = (f: string) => errors[`lrInvoices.${i}.${f}`];
        const flagEway = needsEwayBill(r);
        const dup = duplicates[r.key];
        return (
          <div
            key={r.key}
            role="group"
            aria-label={`Goods invoice ${i + 1}`}
            className="col-span-full rounded-control border border-border-row p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">Goods invoice {i + 1}</span>
              <button
                type="button"
                onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                className={smallButton}
                aria-label={`Remove goods invoice ${i + 1}`}
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="min-w-0">
                <Field
                  label="Invoice no."
                  value={r.invoiceNo}
                  onChange={(e) => update(r.key, { invoiceNo: e.target.value })}
                  onBlur={() => onInvoiceNoBlur(r)}
                  error={err("invoiceNo")}
                />
                {dup?.length ? (
                  <div role="alert" className="mt-1.5 text-[13px] leading-normal text-warning">
                    Already on LR {dup.map((d) => d.lrNo).join(", ")} ·{" "}
                    <Link href={`/lr/${dup[0].id}`}>Open LR {dup[0].lrNo}</Link> ·{" "}
                    <button
                      type="button"
                      onClick={() => onDismissDuplicate(r.key)}
                      className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-primary underline"
                    >
                      Keep it anyway
                    </button>
                  </div>
                ) : null}
              </div>
              <Field
                label="Invoice date"
                type="date"
                value={r.invoiceDate}
                onChange={(e) => update(r.key, { invoiceDate: e.target.value })}
                error={err("invoiceDate")}
              />
              <Field
                label="Value (₹)"
                inputMode="decimal"
                placeholder="₹"
                value={r.value}
                onChange={(e) => update(r.key, { value: e.target.value })}
                onBlur={(e) => update(r.key, { value: tidyRupees(e.target.value) })}
                aiFlag={r.invoiceNo.trim() && !r.value.trim() ? "low-confidence" : undefined}
                error={err("valuePaise")}
              />
              <Field
                label="E-way bill no."
                inputMode="numeric"
                placeholder={flagEway ? "Not on invoice – enter" : "12 digits"}
                value={r.ewayBillNo}
                onChange={(e) => update(r.key, { ewayBillNo: e.target.value })}
                aiFlag={flagEway ? "low-confidence" : undefined}
                aiNote={flagEway ? "Needed: value is over ₹50,000" : undefined}
                className="[&_input]:font-mono [&_input]:placeholder:font-sans"
                error={err("ewayBillNo")}
              />
              <Field
                label="E-way expiry"
                type="datetime-local"
                value={r.ewayExpiresAt}
                onChange={(e) => update(r.key, { ewayExpiresAt: e.target.value })}
                error={err("ewayExpiresAt")}
              />
            </div>
          </div>
        );
      })}
      <div className="col-span-full flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onChange([...rows, emptyInvoiceRow()])}
          className="min-h-control cursor-pointer rounded-control border border-dashed border-border-dashed bg-surface px-4 text-sm font-semibold text-primary"
        >
          + Add invoice
        </button>
        {rows.length > 0 && (
          <div className="text-sm" aria-live="polite">
            Total goods value <b>{formatRupees(total)}</b>
            {rows.length > 1 && <span className="text-muted"> · {rows.length} invoices</span>}
          </div>
        )}
      </div>
    </>
  );
}

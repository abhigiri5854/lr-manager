"use client";

import { Field } from "@/components/ui/Field";
import { emptyInvoiceRow, tidyRupees, type FormErrors, type LrInvoiceRow } from "@/lib/lr-form";

/**
 * Goods invoices carried on the LR (repeatable): invoice no., date, value, e-way bill and expiry.
 * Renders inside the "Vehicle & documents" grid; each invoice spans the full width.
 */
export function LrInvoicesEditor({
  rows,
  onChange,
  errors,
}: {
  rows: LrInvoiceRow[];
  onChange: (rows: LrInvoiceRow[]) => void;
  errors: FormErrors;
}) {
  const update = (key: string, patch: Partial<LrInvoiceRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const many = rows.length > 1;

  return (
    <>
      {rows.map((r, i) => {
        const err = (f: string) => errors[`lrInvoices.${i}.${f}`];
        const filled = r.invoiceNo.trim() !== "";
        return (
          <div
            key={r.key}
            className={
              many ? "col-span-full rounded-control border border-border-row p-4" : "col-span-full"
            }
          >
            {many && (
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Invoice {i + 1}</span>
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                  className="min-h-9 cursor-pointer rounded-control border border-border-input bg-surface px-3 text-sm font-semibold"
                  aria-label={`Remove invoice ${i + 1}`}
                >
                  Remove
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="Invoice no."
                value={r.invoiceNo}
                onChange={(e) => update(r.key, { invoiceNo: e.target.value })}
                error={err("invoiceNo")}
              />
              <Field
                label="Invoice date"
                type="date"
                value={r.invoiceDate}
                onChange={(e) => update(r.key, { invoiceDate: e.target.value })}
                error={err("invoiceDate")}
              />
              <Field
                label="Goods value (₹)"
                inputMode="decimal"
                value={r.value}
                onChange={(e) => update(r.key, { value: e.target.value })}
                onBlur={(e) => update(r.key, { value: tidyRupees(e.target.value) })}
                aiFlag={filled && !r.value.trim() ? "low-confidence" : undefined}
                error={err("valuePaise")}
              />
              <Field
                label="E-way bill no."
                inputMode="numeric"
                placeholder={filled ? "Not on invoice – enter" : "12 digits"}
                value={r.ewayBillNo}
                onChange={(e) => update(r.key, { ewayBillNo: e.target.value })}
                aiFlag={filled && !r.ewayBillNo.trim() ? "low-confidence" : undefined}
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
      <div className="col-span-full">
        <button
          type="button"
          onClick={() => onChange([...rows, emptyInvoiceRow()])}
          className="min-h-control cursor-pointer rounded-control border border-dashed border-border-dashed bg-surface px-4 text-sm font-semibold text-primary"
        >
          + Add invoice
        </button>
      </div>
    </>
  );
}

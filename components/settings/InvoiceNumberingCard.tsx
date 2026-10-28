"use client";

import { useState, useTransition } from "react";
import { saveInvoiceSettingsAction } from "@/app/(app)/settings/company/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { formatInvoiceNo, INVOICE_NO_MAX } from "@/lib/validators/invoice";

/** Company profile → tax invoice prefix and round-off. */
export function InvoiceNumberingCard({
  version,
  prefix: savedPrefix,
  roundOff: savedRoundOff,
  nextCounter,
  fy,
}: {
  version: number;
  prefix: string;
  roundOff: boolean;
  /** Next counter in this FY's tax-invoice series. */
  nextCounter: number;
  fy: string;
}) {
  const [prefix, setPrefix] = useState(savedPrefix);
  const [roundOff, setRoundOff] = useState(savedRoundOff);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const clean = prefix.trim().toUpperCase();
  const preview = formatInvoiceNo(clean, nextCounter);

  function save() {
    setSaved(false);
    startTransition(async () => {
      const r = await saveInvoiceSettingsAction(version, {
        taxInvoicePrefix: prefix,
        invoiceRoundOff: roundOff,
      });
      if (r.ok) {
        setErrors({});
        setPrefix(clean);
        setSaved(true);
      } else if (r.kind === "validation") {
        setErrors(Object.fromEntries(r.issues.map((i) => [i.path || "form", i.message])));
      } else {
        setErrors({ form: r.message });
      }
    });
  }

  return (
    <Card title="Tax invoice numbering" className="max-w-[720px]">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-4"
      >
        <Field
          label="Invoice number prefix"
          name="taxInvoicePrefix"
          value={prefix}
          onChange={(e) => {
            setPrefix(e.target.value);
            setSaved(false);
          }}
          autoCapitalize="characters"
          className="[&_input]:font-mono"
          hint={
            <>
              A-Z, 0-9, / and - only; the full number is at most {INVOICE_NO_MAX} characters.{" "}
              {preview ? (
                <>
                  Next invoice in FY {fy}: <b className="font-mono">{preview}</b>
                </>
              ) : (
                "Prefix is too long or has other characters."
              )}
            </>
          }
          error={errors.taxInvoicePrefix}
        />
        <p className="m-0 text-sm text-muted">
          Drafts have no number. The next number is taken when an invoice is finalised, and each
          financial year starts again at 001.
        </p>
        <label className="flex min-h-control cursor-pointer items-center gap-2 text-sm font-semibold text-label">
          <input
            type="checkbox"
            checked={roundOff}
            onChange={(e) => {
              setRoundOff(e.target.checked);
              setSaved(false);
            }}
            className="h-5 w-5"
          />
          Round invoice totals to the nearest rupee (shown as a Round off line)
        </label>
        {errors.form && (
          <p role="alert" className="m-0 text-sm text-danger">
            {errors.form}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {saved && (
            <span role="status" className="text-sm text-success">
              Saved
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

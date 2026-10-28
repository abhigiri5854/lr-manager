"use client";

import { useState, useTransition } from "react";
import { createCompanyAction } from "@/app/(app)/settings/company/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { isValidGstin, normaliseGstin } from "@/lib/validators/common";
import { companyCreateSchema, companyRuleErrors } from "@/lib/validators/company";

/** "+ Add company" (dashed button in the Editing banner) and its dialog. */
export function AddCompanyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 cursor-pointer rounded-control border border-dashed border-border-dashed bg-surface px-3.5 text-sm font-semibold text-primary"
      >
        + Add company
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add company"
        description="You become its Owner and “Working as” switches to it. Fill in the rest of the profile afterwards."
      >
        <AddCompanyForm onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function AddCompanyForm({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState({ name: "", label: "", city: "", gstin: "", pan: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const bind = (key: keyof typeof v) => ({
    name: key,
    value: v[key],
    onChange: (e: { target: { value: string } }) => {
      const value = e.target.value;
      setV((s) => {
        const next = { ...s, [key]: value };
        // PAN is GSTIN characters 3–12: fill it in when the GSTIN is complete.
        if (key === "gstin" && !s.pan && isValidGstin(value)) {
          next.pan = normaliseGstin(value).slice(2, 12);
        }
        return next;
      });
    },
    error: errors[key],
  });

  function submit() {
    setFormError(null);
    const parsed = companyCreateSchema.safeParse(v);
    const issues = parsed.success
      ? companyRuleErrors(parsed.data)
      : parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    if (issues.length) {
      setErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const r = await createCompanyAction(v);
      if (r.ok) onDone();
      else if (r.kind === "validation")
        setErrors(Object.fromEntries(r.issues.map((i) => [i.path, i.message])));
      else setFormError(r.message);
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <Field label="Company name (printed)" className="sm:col-span-2" autoFocus {...bind("name")} />
      <Field label="Short name (Working as)" {...bind("label")} />
      <Field label="City" {...bind("city")} />
      <Field
        label="GSTIN"
        autoCapitalize="characters"
        className="[&_input]:font-mono"
        {...bind("gstin")}
      />
      <Field
        label="PAN no."
        autoCapitalize="characters"
        className="[&_input]:font-mono"
        {...bind("pan")}
      />
      {formError && (
        <p role="alert" className="m-0 text-sm text-danger sm:col-span-2">
          {formError}
        </p>
      )}
      <div className="mt-2 flex flex-wrap justify-end gap-3 sm:col-span-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add company"}
        </Button>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { registerCompanyAction } from "@/app/register/actions";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

const EMPTY = {
  code: "",
  name: "",
  label: "",
  city: "",
  gstin: "",
  pan: "",
  ownerName: "",
  ownerMobile: "",
  ownerEmail: "",
  password: "",
};
type Form = typeof EMPTY;

/** Company details + the first Owner's login. Signs the Owner in and opens the Dashboard. */
export function RegisterForm() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const bind = (key: keyof Form) => ({
    name: key,
    value: form[key],
    onChange: (e: { target: { value: string } }) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      setErrors((all) => {
        const rest = { ...all };
        delete rest[key];
        return rest;
      });
    },
    error: errors[key],
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        startTransition(async () => {
          // Redirects to the Dashboard on success; only a failure comes back.
          const r = await registerCompanyAction({
            ...form,
            ownerEmail: form.ownerEmail || undefined,
          });
          if (r.kind === "validation") {
            setErrors(Object.fromEntries(r.issues.map((i) => [i.path || "form", i.message])));
            setFormError("Some details need fixing — see the fields marked in red.");
          } else {
            setFormError(r.message);
          }
        });
      }}
      className="flex flex-col gap-4"
    >
      <h2 className="m-0 text-base font-semibold">Company</h2>
      <Field
        label="Company code (login)"
        hint="3–10 letters or digits. Everyone in your company types this to log in."
        autoCapitalize="characters"
        {...bind("code")}
        onChange={(e) => bind("code").onChange({ target: { value: e.target.value.toUpperCase() } })}
      />
      <Field label="Company name (printed)" {...bind("name")} />
      <Field label="Short name (Working as)" {...bind("label")} />
      <Field label="City" {...bind("city")} />
      <Field label="GSTIN" autoCapitalize="characters" className="[&_input]:font-mono" {...bind("gstin")} />
      <Field label="PAN no." autoCapitalize="characters" className="[&_input]:font-mono" {...bind("pan")} />

      <h2 className="m-0 mt-2 text-base font-semibold">First Owner login</h2>
      <Field label="Your name" autoComplete="name" {...bind("ownerName")} />
      <Field
        label="Mobile number"
        type="tel"
        inputMode="tel"
        placeholder="10-digit mobile"
        autoComplete="username"
        {...bind("ownerMobile")}
      />
      <Field
        label="Email (optional)"
        type="email"
        inputMode="email"
        autoComplete="email"
        {...bind("ownerEmail")}
      />
      <Field
        label="Password"
        type="password"
        hint="At least 8 characters"
        autoComplete="new-password"
        {...bind("password")}
      />

      {formError && (
        <p role="alert" className="m-0 text-sm text-danger">
          {formError}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Registering…" : "Register company"}
      </Button>
      <Link
        href="/login"
        className="text-center text-sm font-semibold text-primary underline hover:text-primary-hover"
      >
        Back to log in
      </Link>
    </form>
  );
}

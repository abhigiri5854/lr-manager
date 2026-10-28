"use client";

import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { loginAction } from "@/app/login/actions";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

/** Login.dc.html: mobile / email + password. OTP and password reset come with Supabase Auth. */
export function LoginForm() {
  const next = useSearchParams().get("next") ?? "";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setNote(null);
        startTransition(async () => {
          // Redirects on success; only a failure comes back.
          const r = await loginAction({ identifier, password, next });
          setError(r.message);
        });
      }}
      className="flex flex-col gap-4"
    >
      <Field
        label="Mobile number or email"
        name="identifier"
        placeholder="10-digit mobile"
        autoComplete="username"
        inputMode="email"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        placeholder="••••••••"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Logging in…" : "Log in"}
      </Button>
      <Button
        variant="secondary"
        onClick={() => setNote("Login by OTP isn't switched on yet — use your password for now.")}
      >
        Get OTP instead
      </Button>
      <button
        type="button"
        onClick={() =>
          setNote("Ask your company Owner — they can set a new password from Users & roles.")
        }
        className="cursor-pointer border-0 bg-transparent p-0 text-center text-sm text-primary underline hover:text-primary-hover"
      >
        Forgot password?
      </button>
      {note && (
        <p role="status" className="m-0 text-center text-sm text-muted">
          {note}
        </p>
      )}
    </form>
  );
}

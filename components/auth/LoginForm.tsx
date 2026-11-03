"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { loginAction } from "@/app/login/actions";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

function FieldIcon({ kind }: { kind: "company" | "user" | "lock" }) {
  const paths = {
    company: <><path d="M3.5 20h17M5.5 20V5.5l6.5-2 6.5 2V20M8.5 8h.01M15.5 8h.01M8.5 11.5h.01M15.5 11.5h.01M10 20v-4h4v4" /><path d="M2.5 20h19" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.5-3.2 3.1-5 7-5s6.5 1.8 7 5" /></>,
    lock: <><rect x="4.5" y="10" width="15" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3" /></>,
  };

  return <svg className="login-input-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">{paths[kind]}</svg>;
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {visible ? <><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.6 4.7 9.5 6-.3.5-1.3 2-3 3.4M6.2 6.2C4.1 7.4 2.8 9.3 2.5 11c.4.7 3.7 7 9.5 7 1.2 0 2.3-.3 3.3-.8" /></> : <><path d="M2.5 12s3.3-7 9.5-7 9.5 7 9.5 7-3.3 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="3" /></>}
    </svg>
  );
}

/** Login form keeps the current server action and redirects; only its presentation is customized. */
export function LoginForm() {
  const next = useSearchParams().get("next") ?? "";
  const [companyCode, setCompanyCode] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setNote(null);
          startTransition(async () => {
            // Redirects on success; only a failure comes back.
            const r = await loginAction({ companyCode, identifier, password, next });
            setError(r.message);
          });
        }}
        className="login-form"
      >
        <div className="login-field-wrap">
          <Field
            label="Company code"
            name="companyCode"
            placeholder="e.g. ACM"
            autoComplete="organization"
            autoCapitalize="characters"
            value={companyCode}
            onChange={(e) => setCompanyCode(e.target.value.toUpperCase())}
            aria-invalid={error ? true : undefined}
          />
          <FieldIcon kind="company" />
        </div>
        <div className="login-field-wrap">
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
          <FieldIcon kind="user" />
        </div>
        <div className="login-field-wrap login-password-wrap">
          <Field
            label="Password"
            name="password"
            type={passwordVisible ? "text" : "password"}
            placeholder="Enter your password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          <FieldIcon kind="lock" />
          <button
            type="button"
            className="login-password-toggle"
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? "Hide password" : "Show password"}
            aria-pressed={passwordVisible}
          >
            <EyeIcon visible={passwordVisible} />
          </button>
        </div>
        {error && <p role="alert" className="login-error">{error}</p>}
        <Button type="submit" disabled={pending} className="login-submit">
          {pending && <span className="login-spinner" aria-hidden="true" />}
          {pending ? "Logging in…" : "Log in to your account"}
          {!pending && <span className="login-submit-arrow" aria-hidden="true">→</span>}
        </Button>
        <div className="login-form-links">
          <button
            type="button"
            onClick={() => setNote("Ask your company Owner — they can set a new password from Users & roles.")}
            className="login-text-link"
          >
            Forgot password?
          </button>
          <span className="login-link-divider" aria-hidden="true" />
          <Link href="/register" className="login-text-link">Register a new company</Link>
        </div>
        {note && <p role="status" className="login-note">{note}</p>}
      </form>

      <style jsx global>{`
        .login-form{display:flex;flex-direction:column;gap:15px}
        .login-field-wrap{position:relative}.login-field-wrap>div:first-child{min-width:0}
        .login-field-wrap label{margin-bottom:7px;color:#344054;font-size:12px;font-weight:600}
        .login-field-wrap input{height:46px;padding-left:41px!important;border-color:#d8deea;border-radius:10px;background:#f8f9fc;font-size:13px;transition:border-color .2s,box-shadow .2s,background .2s}
        .login-field-wrap input:focus{border-color:#3855a0;background:#fff;box-shadow:0 0 0 3px rgba(56,85,160,.13);outline:none}
        .login-field-wrap input::placeholder{color:#9aa4b5}.login-input-icon{position:absolute;left:13px;bottom:13px;width:18px;height:18px;pointer-events:none;stroke:#8b96aa;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
        .login-field-wrap:focus-within .login-input-icon{stroke:#3855a0}.login-password-wrap input{padding-right:46px!important}
        .login-password-toggle{position:absolute;right:8px;bottom:6px;display:grid;width:34px;height:34px;place-items:center;border:0;border-radius:7px;background:transparent;color:#778298;cursor:pointer}
        .login-password-toggle:hover{background:#edf1f8;color:#334d92}.login-password-toggle:focus-visible,.login-text-link:focus-visible{outline:2px solid #526db5;outline-offset:2px}
        .login-password-toggle svg{width:18px;height:18px;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
        .login-error{margin:-3px 0 0;padding:10px 12px;border:1px solid #f1caca;border-radius:8px;background:#fff5f5;color:#9b1c1c;font-size:12px;line-height:1.45}
        .login-submit{position:relative;width:100%;height:47px;margin-top:2px;border-radius:10px;background:#213c8c;color:#fff;font-size:13px;box-shadow:0 5px 12px rgba(33,60,140,.15);transition:transform .2s,box-shadow .2s,background .2s}
        .login-submit:hover{transform:translateY(-1px);box-shadow:0 9px 18px rgba(33,60,140,.25)}.login-submit:disabled{transform:none}
        .login-submit-arrow{position:absolute;right:17px;font-size:19px;font-weight:400;line-height:1}.login-spinner{width:15px;height:15px;border:2px solid rgba(255,255,255,.4);border-top-color:white;border-radius:50%;animation:login-spinner .7s linear infinite}
        .login-form-links{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:2px}.login-text-link{padding:2px 0;border:0;background:none;color:#405a9c;font:inherit;font-size:11px;font-weight:600;text-decoration:none;cursor:pointer}
        .login-text-link:hover{color:#263f83;text-decoration:underline}.login-link-divider{width:1px;height:13px;background:#d9deea}.login-note{margin:0;padding:9px 10px;border-radius:7px;background:#f2f5fb;color:#56647c;text-align:center;font-size:11px;line-height:1.5}
        @keyframes login-spinner{to{transform:rotate(360deg)}}
        @media(max-width:390px){.login-form{gap:13px}.login-form-links{gap:9px}.login-text-link{font-size:10px}}
        @media(prefers-reduced-motion:reduce){.login-spinner{animation:none}}
      `}</style>
    </>
  );
}

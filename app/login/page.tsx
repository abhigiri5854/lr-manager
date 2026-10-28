import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { getSessionUserId } from "@/lib/data/session";

export const metadata: Metadata = { title: "Log in" };

/** Already signed in → straight to the Dashboard. */
async function SignedInRedirect() {
  if (await getSessionUserId()) redirect("/");
  return null;
}

export default function LoginPage() {
  return (
    <main className="box-border flex min-h-screen items-center justify-center bg-navy p-page font-sans text-text max-sm:p-4">
      <div className="box-border flex w-full max-w-[420px] flex-col gap-4 rounded-[16px] bg-surface p-8 max-sm:p-6">
        <Suspense>
          <SignedInRedirect />
        </Suspense>
        <h1 className="m-0 text-2xl font-bold">
          LR <span className="text-primary">Manager</span>
        </h1>
        <p className="m-0 text-sm text-muted">
          Log in with your mobile number. Owners and staff land on the Dashboard; drivers on My
          trips.
        </p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { getSessionUserId } from "@/lib/data/session";

export const metadata: Metadata = { title: "Register a new company" };

async function SignedInRedirect() {
  if (await getSessionUserId()) redirect("/");
  return null;
}

export default function RegisterPage() {
  return (
    <main className="box-border flex min-h-screen items-center justify-center bg-navy p-page font-sans text-text max-sm:p-4">
      <div className="box-border flex w-full max-w-[520px] flex-col gap-4 rounded-[16px] bg-surface p-8 max-sm:p-6">
        <Suspense>
          <SignedInRedirect />
        </Suspense>
        <h1 className="m-0 text-2xl font-bold">Register a new company</h1>
        <p className="m-0 text-sm text-muted">
          Your company gets its own code. You become its Owner and log in with the code, your
          mobile number and the password below.
        </p>
        <RegisterForm />
      </div>
    </main>
  );
}

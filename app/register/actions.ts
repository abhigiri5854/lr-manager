"use server";

import { redirect } from "next/navigation";
import { toActionFailure, type ActionFailure } from "@/lib/data/errors";
import { registerCompany } from "@/lib/data/register";
import { logIn } from "@/lib/data/session";
import type { RegisterCompanyInput } from "@/lib/validators/company";

/** Creates the company and its first Owner, then signs that Owner in. Redirects on success. */
export async function registerCompanyAction(input: RegisterCompanyInput): Promise<ActionFailure> {
  try {
    await registerCompany(input);
  } catch (e) {
    return toActionFailure(e);
  }
  const code = String(input.code).trim().toUpperCase();
  const r = await logIn(code, input.ownerMobile, input.password);
  if (!r.ok) return { ok: false, kind: "error", message: r.message };
  redirect("/");
}

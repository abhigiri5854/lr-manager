"use server";

import { redirect } from "next/navigation";
import { logIn } from "@/lib/data/session";

/** Only paths on this site ("/lr?x=1"), never "//evil.com" or full URLs. */
function safeNext(next: string): string | null {
  return /^\/(?![/\\])/.test(next) && !next.startsWith("/login") ? next : null;
}

export async function loginAction(input: {
  companyCode: string;
  identifier: string;
  password: string;
  next: string;
}): Promise<{ ok: false; message: string }> {
  if (!input.companyCode.trim() || !input.identifier.trim() || !input.password) {
    return { ok: false, message: "Enter your company code, mobile number or email, and password." };
  }
  const r = await logIn(input.companyCode, input.identifier, input.password);
  if (!r.ok) return r;
  redirect(r.home === "/driver" ? "/driver" : (safeNext(input.next) ?? "/"));
}

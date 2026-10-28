import { cookies } from "next/headers";
import { connection } from "next/server";
import { can, deniedMessage, type Action } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { DEFAULT_SESSION, db } from "./_store";
import { ForbiddenError, NotFoundError } from "./errors";

// Until Supabase Auth is wired up (Phase 4) everyone is the mock owner. The company chosen in
// "Working as" is kept in a cookie and re-checked against the user's memberships on every read.
// Both getters wait for the request, so pages that use them render per request.

const COMPANY_COOKIE = "lrm_company";

export async function getCurrentUserId(): Promise<string> {
  await connection();
  return DEFAULT_SESSION.userId;
}

function activeMembership(userId: string, companyId: string) {
  return db.memberships.find(
    (m) =>
      m.userId === userId &&
      m.companyId === companyId &&
      !m.cancelledAt &&
      db.companies.some((c) => c.id === companyId && !c.cancelledAt),
  );
}

/** The company chosen in "Working as" (falls back to the user's first company). */
export async function getActiveCompanyId(): Promise<string> {
  const userId = await getCurrentUserId();
  const chosen = (await cookies()).get(COMPANY_COOKIE)?.value;
  if (chosen && activeMembership(userId, chosen)) return chosen;
  const first = db.memberships.find(
    (m) => m.userId === userId && activeMembership(userId, m.companyId),
  );
  return first?.companyId ?? DEFAULT_SESSION.companyId;
}

/** Switches "Working as". Only from a server action (it sets a cookie). */
export async function setActiveCompany(companyId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!activeMembership(userId, companyId)) throw new NotFoundError("Company");
  (await cookies()).set(COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** The current user's role in a company, or null when they aren't a member. */
export async function getRole(companyId: string): Promise<Role | null> {
  const userId = await getCurrentUserId();
  return activeMembership(userId, companyId)?.role ?? null;
}

/**
 * Throws ForbiddenError unless the current user's role in this company allows the action
 * (lib/permissions.ts). Every lib/data write calls this first. Returns the role.
 */
export async function assertCan(companyId: string, ...actions: Action[]): Promise<Role> {
  const role = await getRole(companyId);
  const allowed = actions.find((a) => can(role, a));
  if (!role || !allowed) throw new ForbiddenError(deniedMessage(role, actions[0]));
  return role;
}

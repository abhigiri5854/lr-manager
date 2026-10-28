import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { can, deniedMessage, type Action } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { normaliseMobile } from "@/lib/validators/common";
import { db, now, passwordMatches, setAuditActor } from "./_store";
import { ForbiddenError, NotFoundError } from "./errors";

// Mock login until Supabase Auth: the session cookie holds the user id plus an HMAC so it
// can't be forged. The company chosen in "Working as" is a second cookie, re-checked against
// the user's memberships on every read. Everything here waits for the request, so pages that
// use it render per request.

export const SESSION_COOKIE = "lrm_session";
const COMPANY_COOKIE = "lrm_company";
const WEEK = 60 * 60 * 24 * 7;

// SESSION_SECRET in production; otherwise one random secret per server process (dev restarts
// log everyone out, which is fine for the mock).
const g = globalThis as typeof globalThis & { __lrmSessionSecret?: string };
const secret = () =>
  process.env.SESSION_SECRET ?? (g.__lrmSessionSecret ??= randomBytes(32).toString("hex"));

const sign = (userId: string) => createHmac("sha256", secret()).update(userId).digest("base64url");

/** "userId.signature" — exported for tests. */
export function sessionCookieValue(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

function readSessionCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const userId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(userId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
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

function activeMemberships(userId: string) {
  return db.memberships.filter((m) => m.userId === userId && activeMembership(userId, m.companyId));
}

/** A user may be signed in while they exist, aren't cancelled and belong to a company. */
function canSignIn(userId: string): boolean {
  const user = db.users.find((u) => u.id === userId && !u.cancelledAt);
  return Boolean(user) && activeMemberships(userId).length > 0;
}

/** The signed-in user, or null when logged out (no redirect). */
export async function getSessionUserId(): Promise<string | null> {
  await connection();
  const userId = readSessionCookie((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId || !canSignIn(userId)) return null;
  setAuditActor(userId);
  return userId;
}

/** The signed-in user; sends logged-out visitors to /login. */
export async function getCurrentUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  return userId;
}

export async function getCurrentUser() {
  const userId = await getCurrentUserId();
  const u = db.users.find((x) => x.id === userId)!;
  return { id: u.id, name: u.name, mobile: u.mobile, email: u.email };
}

/** The company chosen in "Working as" (falls back to the user's first company). */
export async function getActiveCompanyId(): Promise<string> {
  const userId = await getCurrentUserId();
  const chosen = (await cookies()).get(COMPANY_COOKIE)?.value;
  if (chosen && activeMembership(userId, chosen)) return chosen;
  return activeMemberships(userId)[0].companyId;
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

// ---------- log in / out ----------

export const LOGIN_FAILED = "Mobile number / email or password is wrong.";

/**
 * Checks the mobile number (or email) and password, then sets the session cookie.
 * Returns where to go: drivers to My trips, everyone else to the Dashboard.
 */
export async function logIn(
  identifier: string,
  password: string,
): Promise<{ ok: true; home: "/" | "/driver" } | { ok: false; message: string }> {
  await connection();
  const id = identifier.trim();
  const mobile = normaliseMobile(id);
  const user = db.users.find(
    (u) =>
      !u.cancelledAt &&
      ((u.mobile !== null && /^\d{10}$/.test(mobile) && u.mobile === mobile) ||
        (u.email !== null && u.email.toLowerCase() === id.toLowerCase())),
  );
  const cred = user && db.credentials.find((c) => c.userId === user.id);
  // Same message whether the user or the password is wrong.
  if (!user || !cred || !passwordMatches(cred, password))
    return { ok: false, message: LOGIN_FAILED };
  if (!canSignIn(user.id)) {
    return { ok: false, message: "This login isn't linked to any company. Ask your Owner." };
  }

  (await cookies()).set(SESSION_COOKIE, sessionCookieValue(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WEEK,
  });
  setAuditActor(user.id);
  user.lastLoginAt = now();
  const roles = activeMemberships(user.id).map((m) => m.role);
  return { ok: true, home: roles.every((r) => r === "driver") ? "/driver" : "/" };
}

export async function logOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(COMPANY_COOKIE);
}

/** The signed-in user's role in the "Working as" company. */
export async function getActiveRole(): Promise<Role | null> {
  return getRole(await getActiveCompanyId());
}

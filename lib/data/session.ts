import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { can, deniedMessage, type Action } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { normaliseMobile } from "@/lib/validators/common";
import { db, now, passwordMatches, setAuditActor } from "./_store";
import { asAnon, asUser, setUserSource } from "./db/conn";
import { ForbiddenError, NotFoundError } from "./errors";
import { onDatabase } from "./source";

// Mock login until Supabase Auth: the session cookie holds the user id plus an HMAC so it
// can't be forged. The company chosen in "Working as" is a second cookie, re-checked against
// the user's memberships on every read. Everything here waits for the request, so pages that
// use it render per request.
//
// DATA_SOURCE=db: the user and their memberships come from the database (read as that user,
// under RLS) and the password is checked by Supabase Auth; the session itself is still this
// cookie until prompt 20.

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

/** A user with their active memberships in active companies, oldest first. */
type Account = {
  user: { id: string; name: string; mobile: string | null; email: string | null };
  memberships: { companyId: string; role: Role }[];
};

function mockAccount(userId: string): Account | null {
  const u = db.users.find((x) => x.id === userId && !x.cancelledAt);
  if (!u) return null;
  const memberships = db.memberships
    .filter(
      (m) =>
        m.userId === userId &&
        !m.cancelledAt &&
        db.companies.some((c) => c.id === m.companyId && !c.cancelledAt),
    )
    .map((m) => ({ companyId: m.companyId, role: m.role }));
  return { user: { id: u.id, name: u.name, mobile: u.mobile, email: u.email }, memberships };
}

/** Read as the user themself (RLS: own user row, own memberships, companies they belong to). */
async function loadDbAccount(userId: string): Promise<Account | null> {
  const rows = await asUser(
    userId,
    null,
    (tx) => tx`
      select u.id, u.name, u.mobile, u.email,
             coalesce((select json_agg(json_build_object('companyId', m.company_id, 'role', m.role)
                                       order by m.created_at, m.id)
                         from memberships m join companies c on c.id = m.company_id
                        where m.user_id = u.id and m.cancelled_at is null
                          and c.cancelled_at is null), '[]') as memberships
        from users u
       where u.id = ${userId} and u.cancelled_at is null`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    user: { id: r.id, name: r.name, mobile: r.mobile, email: r.email },
    memberships: r.memberships as Account["memberships"],
  };
}
/** Once per request (a page asks for the session many times). */
const dbAccount = cache(loadDbAccount);

async function account(userId: string): Promise<Account | null> {
  return onDatabase() ? dbAccount(userId) : mockAccount(userId);
}

/** Signed-in user from the cookie, without any lookup (who the DB transaction runs as). */
async function cookieUserId(): Promise<string | null> {
  await connection();
  return readSessionCookie((await cookies()).get(SESSION_COOKIE)?.value);
}

// lib/data/db/conn.ts runs every query as this user, with the "Working as" company in the claims.
setUserSource(async () => {
  const userId = await cookieUserId();
  if (!userId) return null;
  return { userId, companyId: (await cookies()).get(COMPANY_COOKIE)?.value ?? null };
});

/** The signed-in user, or null when logged out (no redirect). */
export async function getSessionUserId(): Promise<string | null> {
  const userId = await cookieUserId();
  if (!userId) return null;
  // A user may be signed in while they exist, aren't cancelled and belong to a company.
  const acc = await account(userId);
  if (!acc || acc.memberships.length === 0) return null;
  if (!onDatabase()) setAuditActor(userId);
  return userId;
}

/** The signed-in user; sends logged-out visitors to /login. */
export async function getCurrentUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  return userId;
}

async function currentAccount(): Promise<Account> {
  const userId = await getCurrentUserId();
  return (await account(userId))!;
}

export async function getCurrentUser() {
  return (await currentAccount()).user;
}

/** The company chosen in "Working as" (falls back to the user's first company). */
export async function getActiveCompanyId(): Promise<string> {
  const acc = await currentAccount();
  const chosen = (await cookies()).get(COMPANY_COOKIE)?.value;
  if (chosen && acc.memberships.some((m) => m.companyId === chosen)) return chosen;
  return acc.memberships[0].companyId;
}

/** Switches "Working as". Only from a server action (it sets a cookie). */
export async function setActiveCompany(companyId: string): Promise<void> {
  const userId = await getCurrentUserId();
  // Uncached: "+ Add company" switches to the company it just created in the same request.
  const acc = (onDatabase() ? await loadDbAccount(userId) : mockAccount(userId))!;
  if (!acc.memberships.some((m) => m.companyId === companyId)) throw new NotFoundError("Company");
  (await cookies()).set(COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** The current user's role in a company, or null when they aren't a member. */
export async function getRole(companyId: string): Promise<Role | null> {
  const acc = await currentAccount();
  return acc.memberships.find((m) => m.companyId === companyId)?.role ?? null;
}

/**
 * Throws ForbiddenError unless the current user's role in this company allows the action
 * (lib/permissions.ts). Every lib/data write calls this first. Returns the role.
 * With DATA_SOURCE=db, RLS and the database triggers enforce the same map behind it.
 */
export async function assertCan(companyId: string, ...actions: Action[]): Promise<Role> {
  const role = await getRole(companyId);
  const allowed = actions.find((a) => can(role, a));
  if (!role || !allowed) throw new ForbiddenError(deniedMessage(role, actions[0]));
  return role;
}

// ---------- log in / out ----------

export const LOGIN_FAILED = "Mobile number / email or password is wrong.";

type LoginResult = { ok: true; home: "/" | "/driver" } | { ok: false; message: string };

/**
 * Checks the mobile number (or email) and password, then sets the session cookie.
 * Returns where to go: drivers to My trips, everyone else to the Dashboard.
 */
export async function logIn(identifier: string, password: string): Promise<LoginResult> {
  await connection();
  const id = identifier.trim();
  const mobile = normaliseMobile(id);
  const key = /^\d{10}$/.test(mobile) ? mobile : id;
  const userId = onDatabase()
    ? await dbCheckPassword(key, password)
    : mockCheckPassword(id, mobile, password);
  // Same message whether the user or the password is wrong.
  if (!userId) return { ok: false, message: LOGIN_FAILED };
  const acc = await account(userId);
  if (!acc || acc.memberships.length === 0) {
    return { ok: false, message: "This login isn't linked to any company. Ask your Owner." };
  }

  (await cookies()).set(SESSION_COOKIE, sessionCookieValue(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WEEK,
  });
  if (onDatabase()) {
    await asUser(userId, null, (tx) => tx`select app.record_login()`);
  } else {
    setAuditActor(userId);
    db.users.find((u) => u.id === userId)!.lastLoginAt = now();
  }
  const roles = acc.memberships.map((m) => m.role);
  return { ok: true, home: roles.every((r) => r === "driver") ? "/driver" : "/" };
}

function mockCheckPassword(id: string, mobile: string, password: string): string | null {
  const user = db.users.find(
    (u) =>
      !u.cancelledAt &&
      ((u.mobile !== null && /^\d{10}$/.test(mobile) && u.mobile === mobile) ||
        (u.email !== null && u.email.toLowerCase() === id.toLowerCase())),
  );
  const cred = user && db.credentials.find((c) => c.userId === user.id);
  return user && cred && passwordMatches(cred, password) ? user.id : null;
}

/** Finds the login in the database (as anon), then lets Supabase Auth check the password. */
async function dbCheckPassword(identifier: string, password: string): Promise<string | null> {
  const [found] = await asAnon(
    (tx) => tx`select user_id, auth_email from app.login_lookup(${identifier})`,
  );
  if (!found?.auth_email || !password) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY are not set");
  const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ email: found.auth_email, password }),
  });
  // The Supabase session in the response is not used yet (prompt 20); only "is the password right".
  if (res.status === 400 || res.status === 401) return null;
  if (!res.ok) throw new ForbiddenError("Login is unavailable right now — try again in a minute.");
  return found.user_id as string;
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

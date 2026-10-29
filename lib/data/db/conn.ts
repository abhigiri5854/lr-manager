// The app's database access (DATA_SOURCE=db). One postgres.js client on the Supabase
// transaction pooler (DATABASE_URL, prepare: false). Every query runs inside withUser(): one
// transaction that first switches to role `authenticated` with the signed-in user's JWT claims,
// so auth.uid() works and Row Level Security applies to every statement. Nothing here uses a
// privileged role; migrations and the seed have their own connection (db/scripts).
import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { requireEnv } from "@/db/client";
import { ConflictError, ForbiddenError, ValidationError } from "../errors";

// Plain strings / numbers instead of Date objects: dates stay "2026-10-14", moments become ISO.
const isoMoment = (x: string) =>
  new Date(x.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString();
const TYPES = {
  date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
  moment: {
    to: 1184,
    from: [1114, 1184],
    serialize: (x: string) => x,
    parse: isoMoment,
  },
  int8: {
    to: 20,
    from: [20],
    serialize: (x: number) => String(x),
    parse: (x: string) => Number(x),
  },
};

function makeClient() {
  return postgres(requireEnv("DATABASE_URL"), {
    prepare: false,
    max: 10,
    types: TYPES,
    onnotice: () => {},
    connection: { application_name: "lr-manager-app" },
  });
}

const g = globalThis as typeof globalThis & { __lrmSql?: ReturnType<typeof makeClient> };
const client = () => (g.__lrmSql ??= makeClient());

/** One reserved pool connection holding an open transaction. */
export type Tx = postgres.ReservedSql<Record<string, never>>;

type Ctx = { tx: Tx; userId: string | null };
const current = new AsyncLocalStorage<Ctx>();

/** The user whose RLS context this request uses — set by session.ts from the session cookie. */
type UserSource = () => Promise<{ userId: string; companyId: string | null } | null>;
let userSource: UserSource = async () => null;
export function setUserSource(fn: UserSource): void {
  userSource = fn;
}

/**
 * Runs `fn` in one transaction as the signed-in user (RLS on). Nested calls reuse the
 * transaction, so a write, its audit rows and its number allocation commit or roll back together.
 */
export async function withUser<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const ctx = current.getStore();
  if (ctx?.userId) return fn(ctx.tx);
  const who = await userSource();
  if (!who) throw new ForbiddenError("Sign in first.");
  return asUser(who.userId, who.companyId, fn);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same as withUser, for a known user id (login, right after the password check). */
export async function asUser<T>(
  userId: string,
  companyId: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const ctx = current.getStore();
  if (ctx?.userId === userId) return fn(ctx.tx);
  if (!UUID.test(userId)) throw new ForbiddenError("Sign in first.");
  const claims = JSON.stringify({
    sub: userId,
    role: "authenticated",
    // The "Working as" cookie, for policies that want it; RLS itself checks membership.
    ...(companyId && UUID.test(companyId) ? { company_id: companyId } : {}),
  });
  return run("authenticated", claims, userId, fn);
}

/** Before anyone is signed in (the login lookup): role anon, no user. */
export async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return run("anon", JSON.stringify({ role: "anon" }), null, fn);
}

/**
 * begin + RLS context + fn's queries + commit on one reserved connection. `begin` and the context
 * statement are sent without waiting for their replies: the connection runs statements in order,
 * so both take effect before fn's first query, and two network round trips are saved. The context
 * is a literal (its parts are uuids checked above), so it needs no describe round trip either.
 * Their results are awaited before commit, so any failure still rolls everything back.
 */
async function run<T>(
  role: "authenticated" | "anon",
  claims: string,
  userId: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const tx = (await client().reserve()) as unknown as Tx;
  const literal = `'${claims.replace(/'/g, "''")}'`;
  const opened = Promise.all([
    tx`begin`.execute(),
    tx
      .unsafe(
        `select set_config('request.jwt.claims', ${literal}, true), set_config('role', '${role}', true)`,
      )
      .execute(),
  ]);
  opened.catch(() => {}); // reported through fn's queries / the await below
  try {
    const result = await current.run({ tx, userId }, () => fn(tx));
    await opened;
    await tx`commit`;
    return result;
  } catch (e) {
    await tx`rollback`.catch(() => {});
    throw fromPg(e);
  } finally {
    tx.release();
  }
}

/** Postgres errors the triggers / RLS raise become the app's own error types. */
function fromPg(e: unknown): unknown {
  if (!(e instanceof postgres.PostgresError)) return e;
  switch (e.code) {
    case "42501": // insufficient_privilege: RLS or a guard trigger
      return new ForbiddenError(
        e.message.includes("row-level security") ? "Your role can't do this here." : e.message,
      );
    case "23514": // check_violation: trigger messages are written for users; table checks aren't
      return new ValidationError([
        {
          path: "",
          message: e.message.startsWith("new row for relation")
            ? "Some of these values aren't allowed — check the form and try again."
            : e.message,
        },
      ]);
    case "23505":
      return new ValidationError([{ path: "", message: "This is already saved." }]);
    case "40001":
      return new ConflictError();
    default:
      return e;
  }
}

/** `like` pattern for a search box: lower-cased, %/_ escaped, matches anywhere. */
export function contains(search: string | undefined): string | null {
  const q = search?.trim().toLowerCase();
  return q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
}

/** page / pageSize the same way as the mock's paginate(): 50 max, page ≥ 1. */
export function paging(params: { page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 50);
  const page = Math.max(params.page ?? 1, 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

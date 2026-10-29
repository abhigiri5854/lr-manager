// Postgres access (docs/DATABASE.md §4). The app uses the Supabase transaction pooler (port 6543),
// which can't keep prepared statements, so prepare: false. Migrations / seed use
// DATABASE_URL_DIRECT. lib/data is not switched to this yet.
import { sql as dsql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Reads a required env var; the message names it but never prints its value. */
export function requireEnv(name: "DATABASE_URL" | "DATABASE_URL_DIRECT" | (string & {})): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (add it to .env.local)`);
  return value;
}

/** postgres.js client. `direct` = DATABASE_URL_DIRECT (migrations, seed, admin scripts). */
export function createSql(
  options: { direct?: boolean; max?: number } = {},
): postgres.Sql {
  const url = requireEnv(options.direct ? "DATABASE_URL_DIRECT" : "DATABASE_URL");
  return postgres(url, {
    prepare: false,
    max: options.max ?? 10,
    onnotice: () => {},
    connection: { application_name: "lr-manager" },
  });
}

export function createDb(client: postgres.Sql): Db {
  return drizzle(client, { schema });
}

/** The JWT claims Supabase Auth put on the request (getClaims() on the server). */
export type UserClaims = { sub: string; role?: "authenticated"; email?: string };

/**
 * Runs `fn` in one transaction as this signed-in user, so auth.uid() works and RLS applies to
 * every query (§4). The connection itself is privileged; `set local role` drops that for the
 * transaction only.
 */
export async function asUser<T>(db: Db, claims: UserClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const json = JSON.stringify({ role: "authenticated", ...claims });
    await tx.execute(dsql`select set_config('request.jwt.claims', ${json}, true)`);
    await tx.execute(dsql`set local role authenticated`);
    return fn(tx);
  });
}

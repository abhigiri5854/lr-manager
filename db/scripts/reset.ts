// pnpm db:reset — DEV ONLY. Drops everything the migrations created (tables, enums, view, schema
// app, migration journal), then migrates and seeds again. Supabase Auth users and Storage buckets
// are kept (the seed reuses the users; the storage migration upserts the buckets).
import { getTableName, isTable, sql as dsql } from "drizzle-orm";
import { createDb, createSql } from "../client";
import * as schema from "../schema";
import { runMigrations } from "./migrate";
import { seed } from "./seed";

async function reset(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:reset refuses to run with NODE_ENV=production");
  }
  const sql = createSql({ direct: true, max: 1 });
  const db = createDb(sql);
  const tables = Object.values(schema)
    .filter((v) => isTable(v))
    .map((t) => getTableName(t as Parameters<typeof getTableName>[0]));
  const enums = Object.values(schema)
    .filter((v): v is typeof schema.memberRole => typeof v === "function" && "enumName" in v)
    .map((e) => e.enumName);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(dsql`drop view if exists public.freight_bill_balances`);
      for (const t of tables) {
        await tx.execute(dsql.raw(`drop table if exists public."${t}" cascade`));
      }
      for (const e of enums) await tx.execute(dsql.raw(`drop type if exists public."${e}" cascade`));
      // Also removes the auth.users triggers and storage policies that use app.* functions.
      await tx.execute(dsql`drop schema if exists app cascade`);
      await tx.execute(dsql`drop schema if exists drizzle cascade`);
    });
  } finally {
    await sql.end();
  }
  await runMigrations();
  console.log("Migrated.");
  console.log((await seed()) === "seeded" ? "Seeded." : "Seed skipped.");
}

reset().catch((e: unknown) => {
  console.error("Reset failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

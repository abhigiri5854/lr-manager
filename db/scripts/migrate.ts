// pnpm db:migrate — applies db/migrations (generated + hand-written) over DATABASE_URL_DIRECT.
// Same journal table as drizzle-kit (drizzle.__drizzle_migrations).
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, createSql } from "../client";

export async function runMigrations(): Promise<void> {
  const sql = createSql({ direct: true, max: 1 });
  try {
    await migrate(createDb(sql), {
      migrationsFolder: "db/migrations",
      migrationsTable: "__drizzle_migrations",
      migrationsSchema: "drizzle",
    });
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("db/scripts/migrate.ts")) {
  runMigrations()
    .then(() => console.log("Migrations applied."))
    .catch((e: unknown) => {
      console.error("Migration failed:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}

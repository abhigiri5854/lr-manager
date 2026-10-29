// drizzle-kit (db:generate / db:migrate). Migrations use the direct / session connection
// (DATABASE_URL_DIRECT, port 5432); the app uses the transaction pooler (db/client.ts).
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL_DIRECT;

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  schemaFilter: ["public"],
  dbCredentials: { url: url ?? "" },
  migrations: { table: "__drizzle_migrations", schema: "drizzle" },
  strict: true,
  verbose: true,
});

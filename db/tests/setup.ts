// Loads .env.local (values are never printed) before any test file opens a connection.
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — the DB integration tests need the dev database");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("DB integration tests refuse to run with NODE_ENV=production");
}

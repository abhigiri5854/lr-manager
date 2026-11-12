// Part of `pnpm db:migrate:prod`: dumps the production DB to D:\backups\prod-<yyyy-mm-dd-HHmm>.dump
// (custom format) and exits non-zero if pg_dump fails or the file is under 10 KB.
// Run with --env-file=.env.prod. Never prints URLs or passwords.
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { assertIsProd } from "./env-guard";

const PG_DUMP = "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe";
const DIR = "D:\\backups";
const MIN_BYTES = 10 * 1024;

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function main() {
  assertIsProd("prod backup");
  const raw = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL_DIRECT is not set (.env.prod).");
  const u = new URL(raw);
  mkdirSync(DIR, { recursive: true });
  const file = `${DIR}\\prod-${stamp()}.dump`;

  // Connection details go through PG* env vars so nothing secret is on the command line.
  const res = spawnSync(PG_DUMP, ["-Fc", "--no-owner", "--no-acl", "-f", file], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      PGHOST: u.hostname,
      PGPORT: u.port || "5432",
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: u.pathname.replace(/^\//, "") || "postgres",
      PGSSLMODE: "require",
    },
  });
  if (res.error) throw new Error(`pg_dump could not start: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`pg_dump failed (exit ${res.status}). Not migrating.`);
  const size = statSync(file).size;
  if (size < MIN_BYTES) throw new Error(`Backup is only ${size} bytes (< 10 KB). Not migrating.`);
  console.log(`Backup written: ${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

try {
  main();
} catch (e: unknown) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

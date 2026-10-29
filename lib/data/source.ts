// Where lib/data reads and writes. The app always runs on the database (Supabase Postgres). The
// in-memory sample data (lib/mock via _store.ts) is only for unit tests: lib/test-setup.ts sets
// DATA_SOURCE=mock, and that is honoured only under Vitest. Read on every call so tests can set it.
export function onDatabase(): boolean {
  const mock = (process.env.DATA_SOURCE ?? "").trim().toLowerCase() === "mock";
  return !(mock && !!process.env.VITEST);
}

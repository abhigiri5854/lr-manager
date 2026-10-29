// Where lib/data reads and writes: DATA_SOURCE=db (default, Supabase Postgres) or mock (the
// in-memory sample data; unit tests always use it). Read on every call so tests can set it.
export function onDatabase(): boolean {
  return (process.env.DATA_SOURCE ?? "db").trim().toLowerCase() !== "mock";
}

/** Areas that still run on the mock store, shown on their screens while DATA_SOURCE=db. */
export const NOT_ON_DATABASE_AREAS =
  "Tax invoices, freight bills, Smart import, the driver app and PDFs";

/** Route handlers of areas still on the mock store answer this while DATA_SOURCE=db. */
export function notOnDatabaseResponse(): Response {
  return new Response(
    "Not yet on the database — this part moves over in the next step (set DATA_SOURCE=mock to use it on sample data).",
    { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}

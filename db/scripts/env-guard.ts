// Keeps dev tooling away from the production Supabase project. The production project id is in
// PROD_PROJECT_ID; the project of a connection string is read from its user ("postgres.<ref>" on the
// pooler) or host ("db.<ref>.supabase.co" direct). Never prints URLs, passwords or keys.

const URL_VARS = ["DATABASE_URL", "DATABASE_URL_DIRECT"] as const;

/** Supabase project id of a Postgres connection string, or null if it can't be read. */
export function projectIdFromDbUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const fromUser = /^postgres\.([a-z0-9]+)$/i.exec(decodeURIComponent(u.username));
    if (fromUser) return fromUser[1].toLowerCase();
    const fromHost = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(u.hostname);
    return fromHost ? fromHost[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function prodId(): string {
  const id = process.env.PROD_PROJECT_ID?.trim().toLowerCase();
  if (!id) throw new Error("PROD_PROJECT_ID is not set, so dev and prod can't be told apart. Set it and retry.");
  return id;
}

/** Project ids of the DB URLs that are set (DATABASE_URL, DATABASE_URL_DIRECT). */
function dbProjectIds(): { name: string; id: string | null }[] {
  const set = URL_VARS.filter((n) => process.env[n]);
  if (set.length === 0) throw new Error("DATABASE_URL / DATABASE_URL_DIRECT are not set.");
  return set.map((name) => ({ name, id: projectIdFromDbUrl(process.env[name]!) }));
}

/** Throws if any DB URL points at the production project (or its project can't be determined). */
export function assertNotProd(what: string): void {
  const prod = prodId();
  for (const { name, id } of dbProjectIds()) {
    if (id === null) throw new Error(`Refusing ${what}: can't read the project id from ${name}.`);
    if (id === prod) throw new Error(`Refusing ${what}: ${name} points at the PRODUCTION project.`);
  }
}

/** Throws unless every DB URL points at the production project (used by the --prod paths). */
export function assertIsProd(what: string): void {
  const prod = prodId();
  for (const { name, id } of dbProjectIds()) {
    if (id !== prod) throw new Error(`Refusing ${what}: ${name} is not the production project.`);
  }
}

/** Throws if NEXT_PUBLIC_SUPABASE_URL (Auth / Storage) is the production project. */
export function assertSupabaseUrlNotProd(what: string): void {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return;
  const ref = new URL(raw).hostname.split(".")[0].toLowerCase();
  if (ref === prodId()) throw new Error(`Refusing ${what}: NEXT_PUBLIC_SUPABASE_URL is the PRODUCTION project.`);
}

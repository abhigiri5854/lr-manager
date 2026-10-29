// Supabase Auth admin API over fetch (server / scripts only — uses the secret key). Used by the seed
// and the integration tests to make test users; the app will use it for invites later.

type AdminUser = { id: string; email?: string };

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (.env.local)");
  }
  return { base: `${url.replace(/\/$/, "")}/auth/v1/admin/users`, headers: { apikey: key } };
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const { base, headers } = config();
  return fetch(`${base}${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function fail(what: string, res: Response): Promise<never> {
  const text = (await res.text()).slice(0, 200);
  throw new Error(`Supabase Auth ${what} failed (${res.status}): ${text}`);
}

export type NewAuthUser = {
  id: string;
  email: string;
  password: string;
  name: string;
  mobile?: string | null;
};

/** Creates the Auth user with this exact id, or leaves an existing one as it is. */
export async function ensureAuthUser(u: NewAuthUser): Promise<"created" | "existed"> {
  const found = await call("GET", `/${u.id}`);
  if (found.ok) return "existed";
  if (found.status !== 404) await fail("lookup", found);
  const res = await call("POST", "", {
    id: u.id,
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { name: u.name, mobile: u.mobile ?? null },
  });
  if (!res.ok) await fail(`create ${u.email}`, res);
  const created = (await res.json()) as AdminUser;
  if (created.id !== u.id) throw new Error(`Supabase Auth gave ${u.email} a different id`);
  return "created";
}

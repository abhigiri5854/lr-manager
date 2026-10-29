// Supabase Storage for company logos and signatures (DATA_SOURCE=db). Private buckets, object
// paths start with the company id (docs/DATABASE.md §8). Records store the path; screens get the
// same "/uploads/<id>?…" link as with the mock, and app/uploads/[id] turns it into a short-lived
// signed URL after checking the viewer is in that company.
//
// Until real Supabase logins (prompt 20) there is no user token to send to Storage, so lib/data
// checks the permission first (inside the user's RLS transaction) and then calls Storage with the
// secret key. Server only.

export type CompanyBucket = "logos" | "signatures";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** File name as it goes into the object key: letters, digits, dot, dash, underscore. */
export function safeName(name: string, fallback: string): string {
  const clean = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return clean || fallback;
}

/** Where the object lives: logos/{company}/{company}/…, signatures/{company}/…. */
export function objectPath(bucket: CompanyBucket, companyId: string, id: string, name: string) {
  return bucket === "logos"
    ? `${companyId}/${companyId}/${id}-${name}`
    : `${companyId}/${id}-${name}`;
}

/** The app link for a stored path (null in, null out). */
export function urlFromPath(bucket: CompanyBucket, path: string | null): string | null {
  if (!path) return null;
  const file = path.split("/").at(-1)!;
  const id = file.slice(0, 36);
  const name = file.slice(37);
  return `/uploads/${id}?b=${bucket}&n=${encodeURIComponent(name)}`;
}

/**
 * The stored path for an app link from this company's form. Null / empty clears it; a link for
 * another bucket or a malformed one is refused (the validator already checked the shape).
 */
export function pathFromUrl(
  bucket: CompanyBucket,
  companyId: string,
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const u = new URL(url, "http://x");
  const id = u.pathname.replace(/^\/uploads\//, "");
  const name = u.searchParams.get("n") ?? "";
  if (
    !UUID.test(id) ||
    u.searchParams.get("b") !== bucket ||
    safeName(name, "") !== name ||
    !name
  ) {
    throw new Error("Upload the file again");
  }
  return objectPath(bucket, companyId, id, name);
}

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (.env.local)");
  }
  return { base: `${url.replace(/\/$/, "")}/storage/v1`, key };
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Stores the bytes at bucket/path (never overwrites: every upload has a new id). */
export async function putObject(
  bucket: CompanyBucket,
  path: string,
  file: { type: string; bytes: Uint8Array },
): Promise<void> {
  const { base, key } = config();
  const res = await fetch(`${base}/object/${bucket}/${encodePath(path)}`, {
    method: "POST",
    headers: { apikey: key, "content-type": file.type },
    body: Buffer.from(file.bytes),
  });
  if (!res.ok) {
    throw new Error(`Storage upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}

/** A signed URL for reading the object for `seconds`. */
export async function signedUrl(
  bucket: CompanyBucket,
  path: string,
  seconds = 300,
): Promise<string> {
  const { base, key } = config();
  const res = await fetch(`${base}/object/sign/${bucket}/${encodePath(path)}`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: seconds }),
  });
  if (!res.ok) throw new Error(`Storage sign failed (${res.status})`);
  const { signedURL } = (await res.json()) as { signedURL: string };
  return `${base}${signedURL.startsWith("/") ? "" : "/"}${signedURL}`;
}

// Driver links (market drivers, no login): the token, its hash, the encrypted copy the owner can
// resend, the POD file check and a small in-memory rate limit. Server only (node:crypto).
//
// Token: 32 random bytes, base64url (43 chars). The database matches sha256(token) only; the token is
// also kept AES-256-GCM encrypted with DRIVER_LINK_SECRET so "send link again" gives the same URL.
// Without the secret nothing here works (fail closed).
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** A link that is missing, revoked or expired, or a trip that isn't this driver's. */
export class DriverLinkError extends Error {
  constructor(message = "This link is no longer valid. Ask the office to send it again.") {
    super(message);
    this.name = "DriverLinkError";
  }
}

/** Too many requests on one link in a minute. */
export class TooManyRequestsError extends Error {
  constructor() {
    super("Too many requests — wait a minute and try again.");
    this.name = "TooManyRequestsError";
  }
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isTokenShape(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/** sha256(token), lower-case hex: what driver_links.token_hash stores and app.driver_* take. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The 32-byte key from DRIVER_LINK_SECRET (≥ 32 characters). Throws when missing: fail closed. */
export function driverLinkKey(secret = process.env.DRIVER_LINK_SECRET): Buffer {
  if (!secret || secret.trim().length < 32) {
    throw new Error("DRIVER_LINK_SECRET must be set (at least 32 characters) to use driver links");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

/** "v1.<iv>.<tag>.<ciphertext>" (base64url), AES-256-GCM bound to the token's hash. */
export function encryptToken(token: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(hashToken(token)));
  const ct = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** The token back from token_enc; throws if it was tampered with or doesn't match the hash. */
export function decryptToken(enc: string, tokenHash: string, key: Buffer): string {
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unknown driver link format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(tokenHash));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const token = Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Driver link doesn't match its hash");
  return token;
}

// ---------- POD file from the link ----------
export const DRIVER_POD_MAX_BYTES = 10 * 1024 * 1024;
export const DRIVER_POD_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type DriverPodType = (typeof DRIVER_POD_TYPES)[number];

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

/** The type the bytes really are (magic number), or null. The browser's claim is never trusted alone. */
export function sniffPodType(bytes: Uint8Array): DriverPodType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

/** null when fine, else the message for the driver. JPEG / PNG / WebP / PDF, ≤ 10 MB, content matches type. */
export function driverPodFileProblem(file: { name: string; type: string; bytes: Uint8Array }): string | null {
  const name = file.name || "File";
  if (!(DRIVER_POD_TYPES as readonly string[]).includes(file.type))
    return `${name}: send a photo (JPG, PNG, WebP) or a PDF`;
  if (file.bytes.byteLength === 0) return `${name}: the file is empty`;
  if (file.bytes.byteLength > DRIVER_POD_MAX_BYTES) return `${name}: larger than 10 MB`;
  if (sniffPodType(file.bytes) !== file.type) return `${name}: the file doesn't look like a ${file.type.split("/")[1].toUpperCase()}`;
  return null;
}

// ---------- rate limit (per server instance) ----------
/** Fixed-window counter per key: `take(key)` is false once `limit` calls were made in `windowMs`. */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { start: number; n: number }>();
  let lastSweep = 0;
  return {
    take(key: string, now = Date.now()): boolean {
      if (now - lastSweep > windowMs) {
        for (const [k, h] of hits) if (now - h.start >= windowMs) hits.delete(k);
        lastSweep = now;
      }
      const h = hits.get(key);
      if (!h || now - h.start >= windowMs) {
        hits.set(key, { start: now, n: 1 });
        return true;
      }
      h.n += 1;
      return h.n <= limit;
    },
  };
}

import { describe, expect, it } from "vitest";
import {
  createRateLimiter,
  decryptToken,
  DRIVER_POD_MAX_BYTES,
  driverLinkKey,
  driverPodFileProblem,
  encryptToken,
  hashToken,
  isTokenShape,
  newToken,
  sniffPodType,
} from "./driver-link";

const SECRET = "test-secret-that-is-at-least-32-characters-long";

describe("driver link token", () => {
  it("is 32 random bytes in base64url, different every time", () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(isTokenShape(a)).toBe(true);
    expect(isTokenShape("short")).toBe(false);
    expect(isTokenShape(`${a}x`)).toBe(false);
    expect(isTokenShape(null)).toBe(false);
  });

  it("hash is sha256 hex and stable", () => {
    const t = newToken();
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(hashToken(newToken()));
    // Known vector: sha256("abc").
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("encrypt → decrypt gives the same token (owner resends the same URL)", () => {
    const key = driverLinkKey(SECRET);
    const t = newToken();
    const enc = encryptToken(t, key);
    expect(enc.startsWith("v1.")).toBe(true);
    expect(enc).not.toContain(t);
    expect(decryptToken(enc, hashToken(t), key)).toBe(t);
    // A fresh IV each time.
    expect(encryptToken(t, key)).not.toBe(enc);
  });

  it("refuses a wrong secret, a tampered value or another link's hash", () => {
    const key = driverLinkKey(SECRET);
    const t = newToken();
    const enc = encryptToken(t, key);
    expect(() => decryptToken(enc, hashToken(t), driverLinkKey(`${SECRET}-other`))).toThrow();
    const parts = enc.split(".");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 1;
    expect(() => decryptToken([...parts.slice(0, 3), ct.toString("base64url")].join("."), hashToken(t), key)).toThrow();
    expect(() => decryptToken(enc, hashToken(newToken()), key)).toThrow();
    expect(() => decryptToken("v2.a.b.c", hashToken(t), key)).toThrow();
  });

  it("fails closed without DRIVER_LINK_SECRET (or with a short one)", () => {
    expect(() => driverLinkKey(undefined)).toThrow(/DRIVER_LINK_SECRET/);
    expect(() => driverLinkKey("")).toThrow(/DRIVER_LINK_SECRET/);
    expect(() => driverLinkKey("too-short")).toThrow(/DRIVER_LINK_SECRET/);
    expect(driverLinkKey(SECRET)).toHaveLength(32);
  });
});

describe("driver POD file", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]);
  const pdf = new TextEncoder().encode("%PDF-1.7\n");
  const gif = new TextEncoder().encode("GIF89a");

  it("accepts JPEG, PNG, WebP and PDF whose bytes match the type", () => {
    expect(driverPodFileProblem({ name: "a.jpg", type: "image/jpeg", bytes: jpeg })).toBeNull();
    expect(driverPodFileProblem({ name: "a.png", type: "image/png", bytes: png })).toBeNull();
    expect(driverPodFileProblem({ name: "a.webp", type: "image/webp", bytes: webp })).toBeNull();
    expect(driverPodFileProblem({ name: "a.pdf", type: "application/pdf", bytes: pdf })).toBeNull();
    expect(sniffPodType(pdf)).toBe("application/pdf");
  });

  it("refuses other types, empty, oversized and mislabelled files", () => {
    expect(driverPodFileProblem({ name: "a.gif", type: "image/gif", bytes: gif })).toMatch(/photo/);
    expect(driverPodFileProblem({ name: "a.png", type: "image/png", bytes: new Uint8Array() })).toMatch(/empty/);
    const big = new Uint8Array(DRIVER_POD_MAX_BYTES + 1);
    big.set(png);
    expect(driverPodFileProblem({ name: "a.png", type: "image/png", bytes: big })).toMatch(/10 MB/);
    const exact = new Uint8Array(DRIVER_POD_MAX_BYTES);
    exact.set(png);
    expect(driverPodFileProblem({ name: "a.png", type: "image/png", bytes: exact })).toBeNull();
    // An HTML page claiming to be a PDF / JPEG.
    const html = new TextEncoder().encode("<html><script>");
    expect(driverPodFileProblem({ name: "a.pdf", type: "application/pdf", bytes: html })).toMatch(/doesn't look like/);
    expect(driverPodFileProblem({ name: "a.jpg", type: "image/jpeg", bytes: png })).toMatch(/doesn't look like/);
  });
});

describe("rate limit", () => {
  it("allows 60 a minute per key, then refuses until the window passes", () => {
    const rl = createRateLimiter(60, 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) expect(rl.take("a", t0 + i)).toBe(true);
    expect(rl.take("a", t0 + 100)).toBe(false);
    expect(rl.take("b", t0 + 100)).toBe(true); // other links unaffected
    expect(rl.take("a", t0 + 60_000)).toBe(true);
  });
});

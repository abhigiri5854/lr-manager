import { describe, expect, it } from "vitest";
import type { Draft } from "./draft";
import { draftProblems } from "./finish-invoice";
import { readWithRetry } from "./gemini-step";

const draft = (over: Partial<Draft> = {}): Draft => ({
  invoiceNo: "INV1",
  taxablePaise: 100000,
  totalPaise: 118000,
  lines: [
    { description: "x", hsn: "3925", uom: "EA", qty: "10", ratePaise: 10000, gstRateBp: 1800 },
  ],
  ...over,
});

describe("draftProblems", () => {
  it("is empty when the lines add up", () => {
    expect(draftProblems(draft())).toEqual([]);
  });
  it("flags totals that don't match the lines", () => {
    expect(draftProblems(draft({ totalPaise: 999900 }))).toEqual(["totals"]);
  });
  it("flags a GSTIN that fails its checksum, but not an absent one", () => {
    expect(draftProblems({ lines: [], sellerGstin: "10AABCA7061K1ZX" })).toEqual(["sellerGstin"]);
    expect(draftProblems({ lines: [] })).toEqual([]);
  });
});

describe("readWithRetry", () => {
  const ok = draft();
  const bad = draft({ totalPaise: 999900 });

  it("reads once when the cheap model's answer is valid", async () => {
    const models: string[] = [];
    const r = await readWithRetry({ lines: [] }, {}, async (m) => {
      models.push(m);
      return ok;
    });
    expect(models).toEqual(["gemini-3.5-flash-lite"]);
    expect(r).toMatchObject({ used: true, retried: false });
  });

  it("asks gemini-3.5-flash once when the first answer fails validation, and uses its answer", async () => {
    const models: string[] = [];
    const r = await readWithRetry({ lines: [] }, {}, async (m) => {
      models.push(m);
      return m === "gemini-3.5-flash" ? ok : bad;
    });
    expect(models).toEqual(["gemini-3.5-flash-lite", "gemini-3.5-flash"]);
    expect(r.retried).toBe(true);
    expect(r.draft.totalPaise).toBe(118000);
  });

  it("keeps the first answer when the stronger model does worse, and never reads a third time", async () => {
    const worse = draft({ totalPaise: 999900, sellerGstin: "10AABCA7061K1ZX" });
    let calls = 0;
    const r = await readWithRetry({ lines: [] }, {}, async (m) => {
      calls++;
      return m === "gemini-3.5-flash" ? worse : bad;
    });
    expect(calls).toBe(2);
    expect(r.draft.totalPaise).toBe(999900);
    expect(r.draft.sellerGstin).toBeUndefined();
  });

  it("doesn't retry for a problem the QR supplied", async () => {
    const base: Draft = { lines: [], sellerGstin: "10AABCA7061K1ZX" };
    let calls = 0;
    await readWithRetry(base, { sellerGstin: "qr" }, async () => {
      calls++;
      return ok;
    });
    expect(calls).toBe(1);
  });

  it("returns the base when Gemini gave nothing", async () => {
    const r = await readWithRetry({ lines: [] }, {}, async () => null);
    expect(r).toMatchObject({ used: false, retried: false });
  });
});

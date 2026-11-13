import { describe, expect, it } from "vitest";
import {
  computeEwbExpiry,
  ewbBucket,
  ewbTimeLeft,
  ewbValidityDays,
  resolveEwbExpiry,
} from "./ewb-expiry";

// 24:00 India on day D = 18:30 UTC on D.
describe("computeEwbExpiry", () => {
  it("150 km at 200 km/day = 1 day, ends midnight after the day following generation", () => {
    const r = computeEwbExpiry({ generatedOn: "2026-11-10", distanceKm: 150, kmPerDay: 200 });
    expect(r.days).toBe(1);
    expect(r.validUpto).toBe("2026-11-11T18:30:00.000Z");
  });

  it("600 km at 200 km/day = 3 days", () => {
    const r = computeEwbExpiry({ generatedOn: "2026-11-10", distanceKm: 600, kmPerDay: 200 });
    expect(r.days).toBe(3);
    expect(r.validUpto).toBe("2026-11-13T18:30:00.000Z");
  });

  it("uses the India date when generated just after midnight India (still the previous UTC day)", () => {
    // 2026-11-10 19:00 UTC = 2026-11-11 00:30 IST
    const r = computeEwbExpiry({ generatedOn: "2026-11-10T19:00:00.000Z", distanceKm: 150, kmPerDay: 200 });
    expect(r.validUpto).toBe("2026-11-12T18:30:00.000Z");
  });

  it("a late-evening India generation counts as that India day", () => {
    // 2026-11-10 17:00 UTC = 2026-11-10 22:30 IST
    const r = computeEwbExpiry({ generatedOn: "2026-11-10T17:00:00.000Z", distanceKm: 150, kmPerDay: 200 });
    expect(r.validUpto).toBe("2026-11-11T18:30:00.000Z");
  });

  it("crosses a month end", () => {
    const r = computeEwbExpiry({ generatedOn: "2026-11-29", distanceKm: 450, kmPerDay: 200 });
    expect(r.days).toBe(3);
    expect(r.validUpto).toBe("2026-12-02T18:30:00.000Z");
  });

  it("honours a different km/day (ODC 20)", () => {
    expect(ewbValidityDays(100, 20)).toBe(5);
  });

  it("rounds a part day up and never gives 0 days", () => {
    expect(ewbValidityDays(200, 200)).toBe(1);
    expect(ewbValidityDays(201, 200)).toBe(2);
    expect(ewbValidityDays(0, 200)).toBe(1);
  });

  it("rejects bad input", () => {
    expect(() => ewbValidityDays(10, 0)).toThrow();
    expect(() => computeEwbExpiry({ generatedOn: "nope", distanceKm: 10, kmPerDay: 200 })).toThrow();
  });
});

describe("resolveEwbExpiry", () => {
  const base = { ewbNo: "123456789012", enteredUpto: null, generatedOn: "2026-11-10", distanceKm: 150, kmPerDay: 200 };

  it("prefers the entered date", () => {
    expect(resolveEwbExpiry({ ...base, enteredUpto: "2026-11-20T18:30:00.000Z" })).toEqual({
      validUpto: "2026-11-20T18:30:00.000Z",
      source: "entered",
    });
  });

  it("computes when no date was entered", () => {
    expect(resolveEwbExpiry(base)).toEqual({ validUpto: "2026-11-11T18:30:00.000Z", source: "computed" });
  });

  it("returns null without an e-way no. or without data to compute from", () => {
    expect(resolveEwbExpiry({ ...base, ewbNo: null })).toBeNull();
    expect(resolveEwbExpiry({ ...base, generatedOn: null })).toBeNull();
    expect(resolveEwbExpiry({ ...base, distanceKm: null })).toBeNull();
  });
});

describe("time left and buckets", () => {
  const now = new Date("2026-11-11T12:00:00.000Z");
  it("buckets", () => {
    expect(ewbBucket("2026-11-11T11:59:00.000Z", now)).toBe("expired");
    expect(ewbBucket("2026-11-11T17:59:00.000Z", now)).toBe("under6h");
    expect(ewbBucket("2026-11-12T11:59:00.000Z", now)).toBe("under24h");
    expect(ewbBucket("2026-11-12T12:00:00.000Z", now)).toBe("later");
  });
  it("labels", () => {
    expect(ewbTimeLeft("2026-11-11T17:20:00.000Z", now)).toMatchObject({ expired: false, label: "5 h 20 m" });
    expect(ewbTimeLeft("2026-11-13T15:00:00.000Z", now).label).toBe("2 d 3 h");
    expect(ewbTimeLeft("2026-11-11T10:30:00.000Z", now)).toMatchObject({ expired: true, label: "expired 1 h 30 m ago" });
  });
});

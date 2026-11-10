import { describe, expect, it } from "vitest";
import { challanWarnings, rateOutlier, tripMargin, type ChallanInsights } from "./challan-insights";

const base: ChallanInsights = {
  settings: { minMarginPct: 10, rateOutlierPct: 15, ewbAlertHours: 12 },
  lane: null, vehicle: null, driver: null, payee: null, ewb: [],
};

describe("tripMargin", () => {
  it("computes rupees and percent, red below the minimum", () => {
    expect(tripMargin(100000, 85000, 10)).toMatchObject({ marginPaise: 15000, pct: 15, low: false });
    expect(tripMargin(100000, 95000, 10).low).toBe(true);
    expect(tripMargin(100000, 95000, null).low).toBe(false);
    expect(tripMargin(0, 5000, 10)).toMatchObject({ pct: null, low: true });
  });
});

describe("rateOutlier", () => {
  it("flags only above the median by more than the setting", () => {
    expect(rateOutlier(11500, 10000, 15)?.outlier).toBe(false);
    expect(rateOutlier(11600, 10000, 15)?.outlier).toBe(true);
    expect(rateOutlier(11600, 10000, null)?.outlier).toBe(false);
    expect(rateOutlier(0, 10000, 15)).toBeNull();
  });
});

describe("challanWarnings", () => {
  const now = Date.parse("2026-11-04T06:00:00Z");
  it("lists payee, document and e-way problems", () => {
    const w = challanWarnings(
      {
        ...base,
        payee: { name: "Ravi", verified: false, blacklisted: false },
        vehicle: { vehicleNo: "BR01GN8331", insuranceUpto: "2026-10-01", fitnessUpto: "2027-01-01", permitUpto: null },
        driver: { name: "Sunil", dlUpto: "2026-11-03" },
        ewb: [
          { lrNo: "LR1", expiresAt: "2026-11-04T10:00:00Z" },
          { lrNo: "LR2", expiresAt: "2026-11-09T10:00:00Z" },
        ],
      },
      "2026-11-04",
      now,
    );
    expect(w).toHaveLength(4);
    expect(w.join("|")).toMatch(/not verified.*insurance expired.*driving licence expired.*LR1/);
  });
  it("blacklisted replaces unverified", () => {
    const w = challanWarnings({ ...base, payee: { name: "X", verified: false, blacklisted: true } }, "2026-11-04", now);
    expect(w).toEqual(["X is blacklisted — do not pay."]);
  });
});

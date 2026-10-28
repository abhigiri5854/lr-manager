import { describe, expect, it } from "vitest";
import { lrChargeBreakdown } from "./lr-charges";
import type { LrCharges } from "./types";

const none: LrCharges = {
  freight: null,
  packing: null,
  cnCharge: null,
  loading: null,
  unloading: null,
  detention: null,
  other: null,
  gst: null,
  advance: null,
};

describe("lrChargeBreakdown", () => {
  it("is empty when nothing was entered", () => {
    expect(lrChargeBreakdown(none, "consignor").empty).toBe(true);
  });

  it("totals the charges and subtracts the advance", () => {
    const b = lrChargeBreakdown(
      { ...none, freight: 500000, loading: 20000, advance: 100000 },
      "consignor",
    );
    expect(b.totalPaise).toBe(520000);
    expect(b.balancePaise).toBe(420000);
    expect(b.lines.map((l) => l.label)).toEqual(["Freight", "Loading"]);
  });

  it("counts GST only when the transporter pays it", () => {
    const charges = { ...none, freight: 100000, gst: 5000 };
    expect(lrChargeBreakdown(charges, "consignor").totalPaise).toBe(100000);
    expect(lrChargeBreakdown(charges, "transporter").totalPaise).toBe(105000);
  });
});

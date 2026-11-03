import { describe, expect, it } from "vitest";
import {
  calcChallan,
  detentionPaise,
  fromPaise,
  hireAmountPaise,
  latePodFeePaise,
  shortagePaise,
  sumChargesPaise,
  tdsForAllocationPaise,
  tdsHint,
  tdsPaise,
  toPaise,
  tripMargin,
} from "@/lib/hire";

describe("money helpers", () => {
  it("parses numeric(14,2) strings and numbers to paise", () => {
    expect(toPaise("1234.5")).toBe(123450);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise("-10.005")).toBe(-1001);
    expect(toPaise(null)).toBe(0);
  });

  it("formats paise back to numeric(14,2)", () => {
    expect(fromPaise(123405)).toBe("1234.05");
    expect(fromPaise(-5)).toBe("-0.05");
  });

  it("rejects junk amounts", () => {
    expect(() => toPaise("12a")).toThrow();
  });
});

describe("hire amount", () => {
  it("TRIP uses the rate as-is", () => {
    expect(hireAmountPaise("trip", "45000", "21.5")).toBe(4_500_000);
  });

  it("PER_TONNE multiplies rate × tonnes", () => {
    expect(hireAmountPaise("per_tonne", "1800", "21.5")).toBe(3_870_000);
  });

  it("PER_TONNE rounds fractional tonnes to the paisa", () => {
    // 1333.33 × 7.125 = 9499.97625 → 9499.98
    expect(hireAmountPaise("per_tonne", "1333.33", "7.125")).toBe(949_998);
  });

  it("PER_TONNE with no tonnes is 0", () => {
    expect(hireAmountPaise("per_tonne", "1800", null)).toBe(0);
  });

  it("rejects negative rates and unknown bases", () => {
    expect(() => hireAmountPaise("trip", "-1")).toThrow();
    expect(() => hireAmountPaise("per_km" as never, "10")).toThrow();
  });
});

describe("charges", () => {
  const charges = [
    { direction: "add" as const, amount: "1500" },
    { direction: "add" as const, amount: "250.50" },
    { direction: "deduct" as const, amount: "500" },
  ];

  it("sums by direction", () => {
    expect(sumChargesPaise(charges, "add")).toBe(175_050);
    expect(sumChargesPaise(charges, "deduct")).toBe(50_000);
    expect(sumChargesPaise([], "add")).toBe(0);
  });
});

describe("TDS (manual, balance only)", () => {
  it("defaults to 0 when no percent is given", () => {
    expect(tdsPaise(4_500_000, undefined)).toBe(0);
    expect(calcChallan({ basis: "trip", rate: "45000" }).tds).toBe("0.00");
  });

  it("rounds base × % / 100 to the paisa", () => {
    // 12345.67 × 1% = 123.4567 → 123.46
    expect(tdsPaise(1_234_567, "1")).toBe(12_346);
    expect(tdsPaise(4_500_000, "2")).toBe(90_000);
  });

  it("rejects a percent above 100", () => {
    expect(() => tdsPaise(100, "101")).toThrow();
  });

  it("never applies to advance or adjustment allocations", () => {
    expect(tdsForAllocationPaise("advance", 4_500_000, "2")).toBe(0);
    expect(tdsForAllocationPaise("adjustment", 4_500_000, "2")).toBe(0);
    expect(tdsForAllocationPaise("balance", 4_500_000, "2")).toBe(90_000);
  });

  it("hint suggests by PAN type but warns without a declaration", () => {
    expect(tdsHint("ABCPE1234F", false)).toEqual({ suggestedPercent: 1, warning: "No declaration on file" });
    expect(tdsHint("ABCFE1234F", false)).toEqual({ suggestedPercent: 2, warning: "No declaration on file" });
    expect(tdsHint("ABCPE1234F", true)).toEqual({ suggestedPercent: 0, warning: null });
    expect(tdsHint(null, true).suggestedPercent).toBe(20);
  });
});

describe("calcChallan", () => {
  it("computes the full §4 breakdown", () => {
    const r = calcChallan({
      basis: "per_tonne",
      rate: "2000",
      tonnes: "20",
      charges: [
        { direction: "add", amount: "1000" },
        { direction: "deduct", amount: "500" },
      ],
      tdsPercent: "1",
      payments: [
        { kind: "advance", amount: "30000" },
        { kind: "balance", amount: "5000" },
      ],
    });
    expect(r).toEqual({
      hireAmount: "40000.00",
      additions: "1000.00",
      deductions: "500.00",
      grossCredit: "41000.00",
      tdsBase: "41000.00",
      tdsPercent: "1.00",
      tds: "410.00",
      netPayable: "40090.00",
      paid: "35000.00",
      balance: "5090.00",
    });
  });

  it("balance goes negative when overpaid", () => {
    const r = calcChallan({ basis: "trip", rate: "10000", payments: [{ kind: "advance", amount: "10500" }] });
    expect(r.balance).toBe("-500.00");
  });
});

describe("shortage / detention / late POD", () => {
  it("shortage only counts packages beyond the allowance", () => {
    expect(shortagePaise(100, 95, 2, "150")).toBe(45_000);
    expect(shortagePaise(100, 99, 2, "150")).toBe(0);
  });

  it("detention charges whole days beyond free days", () => {
    expect(detentionPaise("2026-11-01T08:00:00Z", "2026-11-04T10:00:00Z", 1, "1000")).toBe(200_000);
    expect(detentionPaise("2026-11-01T08:00:00Z", "2026-11-02T07:00:00Z", 1, "1000")).toBe(0);
  });

  it("late POD fee applies only past the allowed days", () => {
    expect(latePodFeePaise("2026-11-01T00:00:00Z", "2026-11-17T00:00:01Z", 15, "500")).toBe(50_000);
    expect(latePodFeePaise("2026-11-01T00:00:00Z", "2026-11-16T00:00:00Z", 15, "500")).toBe(0);
    expect(latePodFeePaise("2026-11-01T00:00:00Z", null, 15, "500")).toBe(0);
  });
});

describe("trip margin", () => {
  it("revenue − cost with margin %", () => {
    expect(
      tripMargin({ lrFreight: ["30000", "20000"], partyCharges: ["1000"], grossCredit: "41000" }),
    ).toEqual({ revenue: "51000.00", cost: "41000.00", margin: "10000.00", marginPercent: 19.61 });
  });

  it("margin % is null with no revenue", () => {
    const r = tripMargin({ lrFreight: [], grossCredit: "5000" });
    expect(r.margin).toBe("-5000.00");
    expect(r.marginPercent).toBeNull();
  });
});

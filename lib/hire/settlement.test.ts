import { describe, expect, it } from "vitest";
import {
  appliedAutoPaise,
  billColumnFor,
  latePodAutoPaise,
  latePodRule,
  lineShortage,
  podDateIssues,
  settleProblem,
  settlementMoney,
  shortageAllowancePkgs,
  shortageRatePerPkgPaise,
  statusAfterPod,
} from "./settlement";

const U = "2026-11-01T10:00:00+05:30";

describe("late POD fee", () => {
  it("challan days / fee win over the company setting, field by field", () => {
    expect(latePodRule({ allowedDays: 15, fee: "500" }, { allowedDays: 7, fee: null })).toEqual({
      allowedDays: 7,
      fee: "500",
    });
    expect(latePodRule({ allowedDays: null, fee: null }, { allowedDays: null, fee: null })).toEqual({
      allowedDays: null,
      fee: null,
    });
  });

  it("charges the fee only past the allowed days", () => {
    const rule = { allowedDays: 15, fee: "500" };
    expect(latePodAutoPaise(U, "2026-11-17T10:00:01+05:30", rule)).toBe(50_000);
    expect(latePodAutoPaise(U, "2026-11-16T10:00:00+05:30", rule)).toBe(0);
  });

  it("is 0 until both dates are known or when the rule isn't configured", () => {
    expect(latePodAutoPaise(null, "2026-12-30T00:00:00Z", { allowedDays: 1, fee: "10" })).toBe(0);
    expect(latePodAutoPaise(U, null, { allowedDays: 1, fee: "10" })).toBe(0);
    expect(latePodAutoPaise(U, "2026-12-30T00:00:00Z", { allowedDays: null, fee: "10" })).toBe(0);
    expect(latePodAutoPaise(U, "2026-12-30T00:00:00Z", { allowedDays: 1, fee: null })).toBe(0);
  });

  it("0 allowed days: any delay costs the fee", () => {
    expect(latePodAutoPaise(U, "2026-11-01T10:00:01+05:30", { allowedDays: 0, fee: "250.50" })).toBe(
      25_050,
    );
  });
});

describe("override", () => {
  it("keeps the auto amount without an override", () => {
    expect(appliedAutoPaise(50_000, null)).toEqual({ paise: 50_000, overridden: false });
  });
  it("uses the override amount (even 0) with a reason", () => {
    expect(appliedAutoPaise(50_000, { amount: "0", reason: "Owner sent POD by courier on time" })).toEqual({
      paise: 0,
      overridden: true,
    });
    expect(appliedAutoPaise(0, { amount: "199.99", reason: "x" })).toEqual({
      paise: 19_999,
      overridden: true,
    });
  });
  it("refuses an override without a reason", () => {
    expect(() => appliedAutoPaise(1, { amount: "5", reason: "  " })).toThrow("reason");
  });
});

describe("shortage", () => {
  const challan = { hireAmount: "30000", totalLoadedPkgs: 300 };
  const on = { enabled: true, allowancePct: "1", rateSource: "truck_rate" };

  it("is nothing while the company setting is off", () => {
    expect(
      lineShortage({ loadedPkgs: 100, deliveredPkgs: 50, freightAllocated: "10000" }, { ...on, enabled: false }, challan)
        .amountPaise,
    ).toBe(0);
  });

  it("is nothing until delivered packages are entered", () => {
    expect(lineShortage({ loadedPkgs: 100, deliveredPkgs: null, freightAllocated: "1" }, on, challan).amountPaise).toBe(0);
  });

  it("allowance % rounds down", () => {
    expect(shortageAllowancePkgs(150, "1")).toBe(1);
    expect(shortageAllowancePkgs(99, "1")).toBe(0);
    expect(shortageAllowancePkgs(200, "2.5")).toBe(5);
    expect(shortageAllowancePkgs(10, null)).toBe(0);
  });

  it("truck rate = hire ÷ all packages on the challan", () => {
    // 30000 / 300 = ₹100 per package; 200 loaded, 195 delivered, allowance 2 → 3 short.
    const r = lineShortage({ loadedPkgs: 200, deliveredPkgs: 195, freightAllocated: "40000" }, on, challan);
    expect(r).toEqual({ shortPkgs: 3, allowancePkgs: 2, ratePerPkgPaise: 10_000, amountPaise: 30_000 });
  });

  it("party rate = line freight ÷ line packages, rounded to the paisa", () => {
    expect(
      shortageRatePerPkgPaise({ loadedPkgs: 3, deliveredPkgs: 2, freightAllocated: "100" }, "party_rate", challan),
    ).toBe(3333);
  });

  it("no packages loaded: rate 0, no division by zero", () => {
    expect(shortageRatePerPkgPaise({ loadedPkgs: 0, deliveredPkgs: 0, freightAllocated: "1" }, "party_rate", challan)).toBe(0);
    expect(
      shortageRatePerPkgPaise({ loadedPkgs: 0, deliveredPkgs: 0, freightAllocated: "1" }, null, {
        hireAmount: "100",
        totalLoadedPkgs: 0,
      }),
    ).toBe(0);
  });

  it("more delivered than the allowance gap → 0, never negative", () => {
    expect(lineShortage({ loadedPkgs: 100, deliveredPkgs: 100, freightAllocated: "1" }, on, challan).amountPaise).toBe(0);
  });
});

describe("dates and status", () => {
  it("checks the date order", () => {
    expect(podDateIssues({ reportedAt: U, unloadedAt: "2026-10-31T00:00:00Z", podReceivedAt: null })).toEqual([
      { path: "unloadedAt", message: "Unloaded can't be before reported" },
    ]);
    expect(podDateIssues({ reportedAt: null, unloadedAt: null, podReceivedAt: U })[0].path).toBe("unloadedAt");
    expect(podDateIssues({ reportedAt: null, unloadedAt: U, podReceivedAt: "2026-10-01T00:00:00Z" })[0].path).toBe(
      "podReceivedAt",
    );
    expect(podDateIssues({ reportedAt: U, unloadedAt: U, podReceivedAt: U })).toEqual([]);
  });

  it("dispatched → pod_received → back when the POD date is cleared", () => {
    expect(statusAfterPod("dispatched", U)).toBe("pod_received");
    expect(statusAfterPod("in_transit", null)).toBe("in_transit");
    expect(statusAfterPod("pod_received", null)).toBe("dispatched");
    expect(statusAfterPod("settled", null)).toBe("settled");
    expect(statusAfterPod("draft", U)).toBe("draft");
  });

  it("settles on the POD alone — no payment needed", () => {
    expect(settleProblem("pod_received", U)).toBeNull();
    expect(settleProblem("dispatched", null)).toMatch(/POD received/);
    expect(settleProblem("settled", U)).toMatch(/already/);
  });
});

describe("settlement money", () => {
  it("swaps the old POD charges for the new ones; no payments = balance is net payable", () => {
    const m = settlementMoney(
      { hireAmount: "30000", additions: "500", deductions: "200", tds: "0", paid: "0" },
      [{ direction: "deduct", amount: "200" }],
      [
        { direction: "deduct", amount: "500" },
        { direction: "add", amount: "1000" },
      ],
    );
    expect(m).toMatchObject({
      additions: "1500.00",
      deductions: "500.00",
      grossCredit: "31500.00",
      netPayable: "31000.00",
      paid: "0.00",
      balance: "31000.00",
    });
  });

  it("can go negative when deductions exceed what is left (shown, not hidden)", () => {
    const m = settlementMoney(
      { hireAmount: "1000", additions: "0", deductions: "0", tds: "0", paid: "900" },
      [],
      [{ direction: "deduct", amount: "500" }],
    );
    expect(m.balance).toBe("-400.00");
  });
});

it("detention charges go to the bill's detention column, the rest to other", () => {
  expect(billColumnFor("DET", "Detention")).toBe("detention");
  expect(billColumnFor("unloading", "Unloading")).toBe("other");
  expect(billColumnFor(null, null)).toBe("other");
});

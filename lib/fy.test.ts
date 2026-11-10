import { describe, expect, it } from "vitest";
import { fyOptions, isValidFy } from "./fy";

describe("isValidFy", () => {
  it.each(["2026-27", "2099-00", "2025-26"])("accepts %s", (fy) => {
    expect(isValidFy(fy)).toBe(true);
  });

  it.each(["2026-28", "2026-26", "26-27", "2026-2027", "", "2026/27", "2026-7"])("rejects %s", (fy) => {
    expect(isValidFy(fy)).toBe(false);
  });
});

describe("fyOptions", () => {
  it("returns previous, current and next FY", () => {
    expect(fyOptions("2026-11-10")).toEqual(["2025-26", "2026-27", "2027-28"]);
  });

  it("is still the old FY on 31 March", () => {
    expect(fyOptions("2027-03-31")).toEqual(["2025-26", "2026-27", "2027-28"]);
  });

  it("shifts forward on 1 April", () => {
    expect(fyOptions("2027-04-01")).toEqual(["2026-27", "2027-28", "2028-29"]);
  });

  it("handles the century rollover", () => {
    expect(fyOptions("2099-06-01")).toEqual(["2098-99", "2099-00", "2100-01"]);
  });
});

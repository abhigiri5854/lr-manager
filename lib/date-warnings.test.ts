import { describe, expect, it } from "vitest";
import { dateWarning, joinWarnings, numberFyWarning } from "./date-warnings";

const today = "2026-10-29";

describe("dateWarning", () => {
  it("is quiet for a normal recent date", () => {
    expect(dateWarning("2026-10-20", { today })).toBeNull();
    expect(dateWarning(today, { today })).toBeNull();
    expect(dateWarning("", { today })).toBeNull();
  });

  it("warns on future dates and far-off years without blocking", () => {
    expect(dateWarning("2026-10-30", { today })).toBe("This date is in the future");
    expect(dateWarning("2062-10-29", { today })).toMatch(/More than a year in the future/);
    expect(dateWarning("2025-10-28", { today })).toMatch(/More than a year ago/);
    expect(dateWarning("2025-10-29", { today })).toBeNull();
  });

  it("warns when a date is before the one it should follow", () => {
    const notBefore = { date: "2026-10-14", label: "LR date" };
    expect(dateWarning("2026-10-10", { today, notBefore })).toBe("Before the LR date (14-10-2026)");
    expect(dateWarning("2026-10-14", { today, notBefore })).toBeNull();
    expect(dateWarning("2026-11-01", { today, notBefore })).toBe("This date is in the future");
  });
});

describe("numberFyWarning", () => {
  it("names the FY the number was issued in when the date leaves it", () => {
    expect(numberFyWarning("2026-27", "2026-04-01")).toBeNull();
    expect(numberFyWarning("2026-27", "2027-03-31")).toBeNull();
    expect(numberFyWarning("2026-27", "2027-04-01")).toBe("Number belongs to FY 2026-27");
    expect(numberFyWarning("2026-27", "2026-03-31")).toBe("Number belongs to FY 2026-27");
    expect(numberFyWarning(null, "2020-01-01")).toBeNull();
  });

  it("joins notes", () => {
    expect(joinWarnings(null, "a", undefined, "b")).toBe("a · b");
    expect(joinWarnings(null)).toBeNull();
  });
});

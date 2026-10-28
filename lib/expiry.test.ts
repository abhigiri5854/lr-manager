import { describe, expect, it } from "vitest";
import { expiryStatus } from "./expiry";

const today = "2026-10-28";

describe("expiryStatus", () => {
  it("is unset without a date", () => {
    expect(expiryStatus(null, today)).toEqual({ state: "unset" });
  });
  it("is expired from the day after the date", () => {
    expect(expiryStatus("2026-10-27", today)).toEqual({ state: "expired", daysLeft: -1 });
  });
  it("is still valid on the date itself, but soon", () => {
    expect(expiryStatus("2026-10-28", today)).toEqual({ state: "soon", daysLeft: 0 });
  });
  it("warns 15 days ahead, not 16", () => {
    expect(expiryStatus("2026-11-12", today)).toEqual({ state: "soon", daysLeft: 15 });
    expect(expiryStatus("2026-11-13", today)).toEqual({ state: "ok", daysLeft: 16 });
  });
});

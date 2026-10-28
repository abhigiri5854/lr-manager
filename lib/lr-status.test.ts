import { describe, expect, it } from "vitest";
import { deriveLrStatus, ewayUrgency, lrTimeline } from "./lr-status";
import type { LrStatusInput } from "./types";

const T = "2026-10-14T05:30:00.000Z";
const draft: LrStatusInput = {
  cancelledAt: undefined,
  bookedAt: null,
  dispatchedAt: null,
  deliveredAt: null,
  podReceivedAt: null,
  billedAt: null,
  paidAt: null,
};
const booked = { ...draft, bookedAt: T };
const inTransit = { ...booked, dispatchedAt: T };
const delivered = { ...inTransit, deliveredAt: T };
const podReceived = { ...delivered, podReceivedAt: T };
const billed = { ...podReceived, billedAt: "2026-10-27" };
const paid = { ...billed, paidAt: "2026-11-05" };

describe("deriveLrStatus", () => {
  it.each([
    ["Draft", draft],
    ["Booked", booked],
    ["In transit", inTransit],
    ["Delivered", delivered],
    ["POD received", podReceived],
    ["Billed", billed],
    ["Paid", paid],
  ] as const)("%s", (status, input) => {
    expect(deriveLrStatus(input)).toBe(status);
  });

  it("Cancelled wins over everything", () => {
    expect(deriveLrStatus({ ...paid, cancelledAt: T })).toBe("Cancelled");
    expect(deriveLrStatus({ ...draft, cancelledAt: T })).toBe("Cancelled");
  });

  it("a bill can come before the POD (bill prints 'POD awaited')", () => {
    expect(deriveLrStatus({ ...delivered, billedAt: "2026-10-27" })).toBe("Billed");
  });

  it("an un-booked draft stays Draft even if other stamps are present", () => {
    expect(deriveLrStatus({ ...paid, bookedAt: null })).toBe("Draft");
  });
});

describe("ewayUrgency", () => {
  const now = Date.parse("2026-10-15T00:00:00.000Z");
  it("flags expired and expiring e-way bills on moving goods", () => {
    expect(ewayUrgency("In transit", "2026-10-14T23:59:59.000Z", now)).toBe("expired");
    expect(ewayUrgency("Booked", "2026-10-16T00:00:00.000Z", now)).toBe("expiring");
    expect(ewayUrgency("Draft", "2026-10-16T00:00:01.000Z", now)).toBeNull();
  });
  it("ignores delivered LRs and missing dates", () => {
    expect(ewayUrgency("Delivered", "2026-10-01T00:00:00.000Z", now)).toBeNull();
    expect(ewayUrgency("In transit", null, now)).toBeNull();
  });
});

describe("lrTimeline", () => {
  const states = (input: LrStatusInput) => lrTimeline(input).map((s) => s.state);

  it("marks reached stages done and the next one current", () => {
    expect(states(inTransit)).toEqual([
      "done",
      "done",
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(lrTimeline(inTransit)[1].at).toBe(T);
  });

  it("a draft shows one current Draft step, then grey steps with no dates", () => {
    const steps = lrTimeline({ ...draft, dispatchedAt: T });
    expect(steps[0]).toEqual({ stage: "Draft", at: null, state: "current" });
    expect(steps.slice(1).every((s) => s.state === "upcoming" && s.at === null)).toBe(true);
    expect(steps).toHaveLength(7);
  });

  it("has no current stage once cancelled", () => {
    expect(states({ ...booked, cancelledAt: T })).not.toContain("current");
  });

  it("a paid LR is all done", () => {
    expect(new Set(states(paid))).toEqual(new Set(["done"]));
  });
});

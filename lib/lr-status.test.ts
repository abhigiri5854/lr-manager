import { describe, expect, it } from "vitest";
import { deriveLrStatus } from "./lr-status";
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

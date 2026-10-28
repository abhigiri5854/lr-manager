import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetStore } from "./_store";

vi.mock("next/server", () => ({ connection: async () => {} }));
import { getDashboard } from "./dashboard";
import { bookLr, cancelLr, createLr } from "./lrs";
import { createPod } from "./pod";

const acmId = () => db.companies.find((c) => c.label === "ACM Logistics")!.id;
const rsId = () => db.companies.find((c) => c.label === "RS Logistics")!.id;
const lrId = (no: string) => db.lrs.find((l) => l.lrNo === no)!.id;
const partyId = (name: string) => db.parties.find((p) => p.name === name)!.id;

beforeEach(() => {
  resetStore();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T06:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("dashboard", () => {
  it("counts and lists from the sample data", async () => {
    const d = await getDashboard(acmId());
    expect(d.openLrs).toEqual({ total: 2, draft: 1, booked: 0, inTransit: 1 });
    expect(d.eway).toEqual({ total: 1, expired: 1 });
    expect(d.pod).toEqual({ pending: 0, podDays: 10 });
    expect(d.freight).toEqual({ toCollectPaise: null, unbilledTbbLrs: 1 });
    expect(d.recentLrs.map((l) => l.lrNo)).toEqual(["19020", "19019"]);
    expect(d.attention).toEqual([
      expect.objectContaining({ kind: "eway_expired", lrNo: "19019", ewayBillNo: "801755453075" }),
      {
        kind: "draft_incomplete",
        lrId: lrId("19020"),
        lrNo: "19020",
        missing: ["LR date", "e-way bill no.", "weight"],
      },
    ]);
    // Draft 19020 doesn't count, so only 19019's pair is offered.
    expect(d.repeatRoutes.map((r) => `${r.consigneeName} ${r.lastUsedOn}`)).toEqual([
      "Maa Vaishno Hardware 2026-10-14",
    ]);
  });

  it("is empty for a company with no data", async () => {
    const d = await getDashboard(rsId());
    expect(d.openLrs.total).toBe(0);
    expect(d.recentLrs).toEqual([]);
    expect(d.attention).toEqual([]);
    expect(d.repeatRoutes).toEqual([]);
    expect(d.pod.podDays).toBeNull();
  });

  it("flags POD past the company's POD days, and drops the e-way alert once delivered", async () => {
    await createPod(acmId(), { lrId: lrId("19019"), deliveredOn: "2026-10-16" });
    const d = await getDashboard(acmId());
    expect(d.eway.total).toBe(0);
    expect(d.pod.pending).toBe(1);
    expect(d.attention[0]).toEqual({
      kind: "pod_overdue",
      lrId: lrId("19019"),
      lrNo: "19019",
      daysOverdue: 2,
      podDays: 10,
      penaltyPerDayPaise: 5000,
      penaltyPaise: 10000,
    });
  });

  it("builds repeat pairs from booked, non-cancelled LRs only, dated by LR date", async () => {
    const co = acmId();
    const toIndia = {
      consignorId: partyId("Ashirvad Pipes Pvt Ltd"),
      consigneeId: partyId("1789 India Trading"),
      fromPlace: "Painal",
      toPlace: "Motihari",
      paymentMode: "tbb" as const,
      items: [{ description: "Water tank", packages: 5 }],
    };
    const book = async (lrDate: string) => {
      const lr = await createLr(co, { ...toIndia, lrDate });
      return bookLr(co, lr.id, lr.version);
    };

    // Two booked LRs for 1789 India Trading (+ draft 19020 and a cancelled one, which don't count).
    await book("2026-10-18");
    const latest = await book("2026-10-22");
    const cancelled = await book("2026-10-25");
    await cancelLr(co, cancelled.id, { reason: "Booked twice" });
    await createLr(co, { ...toIndia, lrDate: "2026-10-26" }); // draft

    const d = await getDashboard(co);
    expect(d.repeatRoutes.map((r) => [r.consigneeName, r.count, r.lastUsedOn])).toEqual([
      ["1789 India Trading", 2, "2026-10-22"],
      ["Maa Vaishno Hardware", 1, "2026-10-14"],
    ]);
    expect(d.repeatRoutes[0].lrId).toBe(latest.id);
  });

  it("counts e-way bills expiring within 24 hours", async () => {
    await createLr(acmId(), {
      lrInvoices: [
        { invoiceNo: "A1", ewayBillNo: "801755453076", ewayExpiresAt: "2026-10-29T05:00:00.000Z" },
        { invoiceNo: "A2", ewayBillNo: "801755453077", ewayExpiresAt: "2026-10-30T05:00:00.000Z" },
      ],
    });
    const d = await getDashboard(acmId());
    expect(d.eway).toEqual({ total: 2, expired: 1 });
    expect(d.attention.filter((a) => a.kind === "eway_expiring")).toHaveLength(1);
  });
});

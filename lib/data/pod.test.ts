import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetStore } from "./_store";

// Tests run outside a Next.js request, where connection() would throw.
vi.mock("next/server", () => ({ connection: async () => {} }));
import { podDueDate, podLateDays, podPenaltyPaise } from "../pod-rules";
import { ValidationError } from "./errors";
import { getLrById } from "./lrs";
import { createPod, getPodScreen, listInTransitForPod, listPodPendingPage, updatePod } from "./pod";
import { getUpload, uploadPodFile } from "./uploads";

const acmId = () => db.companies.find((c) => c.label === "ACM Logistics")!.id;
const rsId = () => db.companies.find((c) => c.label === "RS Logistics")!.id;
const lrId = (no: string) => db.lrs.find((l) => l.lrNo === no)!.id;

beforeEach(() => resetStore());

describe("POD rules", () => {
  it("due date = delivery + podDays; nothing when unset", () => {
    expect(podDueDate("2026-10-16", 10)).toBe("2026-10-26");
    expect(podDueDate("2026-10-16", null)).toBeNull();
  });

  it("late days and penalty come from the company settings", () => {
    expect(podLateDays("2026-10-16", "2026-10-26", 10)).toBe(0);
    expect(podLateDays("2026-10-16", "2026-10-29", 10)).toBe(3);
    const rules = { podDays: 10, podPenaltyPerDay: 5000 };
    expect(podPenaltyPaise("2026-10-16", "2026-10-29", rules)).toBe(15000);
    expect(
      podPenaltyPaise("2026-10-16", "2026-10-29", { podDays: null, podPenaltyPerDay: null }),
    ).toBe(0);
  });
});

describe("save delivery", () => {
  it("rejects a future date and Short / Damaged without remarks", async () => {
    const co = acmId();
    const id = lrId("19019");
    await expect(createPod(co, { lrId: id, deliveredOn: "2999-01-01" })).rejects.toThrow(/future/);
    await expect(
      createPod(co, { lrId: id, deliveredOn: "2026-10-16", condition: "short" }),
    ).rejects.toThrow(ValidationError);
    expect((await getLrById(co, id))!.deliveredAt).toBeNull();
  });

  it("delivery sets Delivered; the signed copy sets POD received", async () => {
    const co = acmId();
    const id = lrId("19019");
    const pod = await createPod(co, { lrId: id, deliveredOn: "2026-10-16" });
    expect((await getLrById(co, id))!.status).toBe("Delivered");
    expect((await listPodPendingPage(co, {})).rows.map((r) => r.lrNo)).toEqual(["19019"]);

    const file = await uploadPodFile(co, {
      name: "signed.jpg",
      type: "image/jpeg",
      bytes: new Uint8Array([1, 2, 3]),
    });
    await updatePod(co, pod.id, pod.version, { documentUrls: [file.url] });
    expect((await getLrById(co, id))!.status).toBe("POD received");
    expect((await listPodPendingPage(co, {})).total).toBe(0);
  });

  it("a stale version is a conflict", async () => {
    const co = acmId();
    const pod = await createPod(co, { lrId: lrId("19019"), deliveredOn: "2026-10-16" });
    await expect(updatePod(co, pod.id, pod.version + 1, { remarks: "x" })).rejects.toThrow();
  });
});

describe("lists and uploads", () => {
  it("in-transit tab lists booked LRs not yet delivered", async () => {
    const co = acmId();
    const before = (await listInTransitForPod(co, {})).rows.map((r) => r.lrNo);
    expect(before).toContain("19019");
    await createPod(co, { lrId: lrId("19019"), deliveredOn: "2026-10-16" });
    expect((await listInTransitForPod(co, {})).rows.map((r) => r.lrNo)).not.toContain("19019");
  });

  it("screen data carries the company's rules; RS has none", async () => {
    const acm = await getPodScreen(acmId(), lrId("19019"));
    expect(acm).toMatchObject({ podDays: 10, podPenaltyPerDay: 5000 });
    expect(await getPodScreen(rsId(), lrId("19019"))).toBeNull();
  });

  it("only photos and PDFs, and only for the uploading company", async () => {
    await expect(
      uploadPodFile(acmId(), {
        name: "x.exe",
        type: "application/x-msdownload",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(ValidationError);
    const f = await uploadPodFile(acmId(), {
      name: "a.pdf",
      type: "application/pdf",
      bytes: new Uint8Array([1]),
    });
    const id = f.url.split("/")[2].split("?")[0];
    expect(await getUpload(acmId(), id)).not.toBeNull();
    expect(await getUpload(rsId(), id)).toBeNull();
  });
});

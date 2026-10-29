// The LR's cached podReceivedAt / billedAt / paidAt must always equal what lib/lr-status derives
// from the linked POD, bill and payments. Every write path below is checked against every LR.
import { beforeEach, describe, expect, it } from "vitest";
import { deriveLrStatus, lrStampsFrom } from "@/lib/lr-status";
import { db, resetStore } from "./_store";
import { linkedRecordsForLr, statusInputOf } from "./_derive";
import {
  cancelFreightBill,
  cancelPayment,
  createFreightBill,
  createPayment,
  finaliseFreightBill,
  updateFreightBill,
  updatePayment,
} from "./bills";
import { createLr, getLrById } from "./lrs";
import { cancelPod, createPod, updatePod } from "./pod";

const acmId = () => db.companies.find((c) => c.label === "ACM Logistics")!.id;
const lrId = (no: string) => db.lrs.find((l) => l.lrNo === no)!.id;
const partyId = (name: string) => db.parties.find((p) => p.name === name)!.id;

/** For every LR in every company: stored stamps === stamps derived from linked records. */
function expectStampsConsistent() {
  for (const lr of db.lrs) {
    const derived = lrStampsFrom(linkedRecordsForLr(lr.companyId, lr.id));
    expect(
      { podReceivedAt: lr.podReceivedAt, billedAt: lr.billedAt, paidAt: lr.paidAt },
      `LR ${lr.lrNo}`,
    ).toEqual(derived);
    expect(deriveLrStatus(statusInputOf(lr))).toBe(
      deriveLrStatus({ ...statusInputOf(lr), ...derived }),
    );
  }
}

beforeEach(() => resetStore());

describe("cached LR stamps", () => {
  it("start consistent in the sample data", () => {
    expectStampsConsistent();
  });

  it("follow every POD, bill and payment write", async () => {
    const co = acmId();
    const a = lrId("19019");
    const ashirvad = partyId("Ashirvad Pipes Pvt Ltd");
    const b = (
      await createLr(
        co,
        {
          lrDate: "2026-10-28",
          fromPlace: "Painal",
          toPlace: "Motihari",
          consignorId: ashirvad,
          consigneeId: partyId("1789 India Trading"),
          paymentMode: "tbb",
          items: [{ description: "Water tank", packages: 10 }],
        },
        { book: true },
      )
    ).id;
    const status = async (id: string) => (await getLrById(co, id))!.status;

    // POD: delivered without a signed copy, then the copy arrives, then it's cancelled and redone.
    const pod = await createPod(co, { lrId: a, deliveredOn: "2026-10-16" });
    expectStampsConsistent();
    expect(await status(a)).toBe("Delivered");
    const withCopy = await updatePod(co, pod.id, pod.version, { documentUrls: ["/uploads/x"] });
    expectStampsConsistent();
    expect(await status(a)).toBe("POD received");
    await cancelPod(co, withCopy.id);
    expectStampsConsistent();
    expect(db.lrs.find((l) => l.id === a)!.podReceivedAt).toBeNull();
    await createPod(co, {
      lrId: a,
      deliveredOn: "2026-10-16",
      receivedAt: "2026-10-20T10:00:00.000Z",
    });
    expectStampsConsistent();

    // Bill: draft (no stamp), lines changed, finalised (billed), then cancelled.
    const draft = await createFreightBill(co, {
      billDate: "2026-10-27",
      partyId: ashirvad,
      gstMode: "reverse_charge",
      lines: [{ lrId: a, freightPaise: 2500000 }],
    });
    expectStampsConsistent();
    expect(await status(a)).toBe("POD received");
    const edited = await updateFreightBill(co, draft.id, draft.version, {
      lines: [
        { lrId: a, freightPaise: 2500000 },
        { lrId: b, freightPaise: 1000000 },
      ],
    });
    expectStampsConsistent();
    const final = await finaliseFreightBill(co, edited.id, edited.version);
    expectStampsConsistent();
    expect([await status(a), await status(b)]).toEqual(["Billed", "Billed"]);
    await cancelFreightBill(co, final.id);
    expectStampsConsistent();
    expect(await status(b)).toBe("Booked");

    // A new bill for both, then payments: partial, full, edited down, cancelled.
    const d2 = await createFreightBill(co, {
      billDate: "2026-10-28",
      partyId: ashirvad,
      gstMode: "reverse_charge",
      lines: [
        { lrId: a, freightPaise: 2500000 },
        { lrId: b, freightPaise: 1000000 },
      ],
    });
    const bill = await finaliseFreightBill(co, d2.id, d2.version);
    expectStampsConsistent();
    const pay = (amountPaise: number, receivedOn: string) => ({
      partyId: ashirvad,
      amountPaise,
      mode: "neft_upi" as const,
      receivedOn,
      allocations: [{ freightBillId: bill.id, amountPaise }],
    });
    const p1 = await createPayment(co, pay(1500000, "2026-11-01"));
    expectStampsConsistent();
    expect(await status(a)).toBe("Billed");
    const p2 = await createPayment(co, pay(2000000, "2026-11-05"));
    expectStampsConsistent();
    expect(await status(a)).toBe("Paid");
    expect(db.lrs.find((l) => l.id === b)!.paidAt).toBe("2026-11-05");
    const p2b = await updatePayment(co, p2.id, p2.version, pay(1000000, "2026-11-06"));
    expectStampsConsistent();
    expect(await status(b)).toBe("Billed");
    await updatePayment(co, p2b.id, p2b.version, pay(2000000, "2026-11-07"));
    expectStampsConsistent();
    expect(db.lrs.find((l) => l.id === a)!.paidAt).toBe("2026-11-07");
    await cancelPayment(co, p1.id);
    expectStampsConsistent();
    expect(await status(a)).toBe("Billed");
  });

  it("don't bump the LR version or write LR audit rows", async () => {
    const co = acmId();
    const a = lrId("19019");
    await createPod(co, { lrId: a, deliveredOn: "2026-10-16" });
    const before = db.lrs.find((l) => l.id === a)!;
    const lrAudit = db.audit.filter((x) => x.table === "lrs").length;
    const draft = await createFreightBill(co, {
      billDate: "2026-10-27",
      partyId: partyId("Ashirvad Pipes Pvt Ltd"),
      gstMode: "reverse_charge",
      lines: [{ lrId: a, freightPaise: 2500000 }],
    });
    await finaliseFreightBill(co, draft.id, draft.version);
    const after = db.lrs.find((l) => l.id === a)!;
    expect(after.billedAt).toBe("2026-10-27");
    expect(after.version).toBe(before.version);
    expect(db.audit.filter((x) => x.table === "lrs").length).toBe(lrAudit);
  });
});

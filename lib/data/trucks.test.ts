import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetStore } from "./_store";
import { ValidationError } from "./errors";

vi.mock("next/server", () => ({ connection: async () => {} }));
import { getDashboard } from "./dashboard";
import {
  cancelDriver,
  cancelTruck,
  createDriver,
  createTruck,
  inviteDriver,
  listDriverRows,
  listExpiryAlerts,
  listTruckRows,
  updateTruck,
} from "./trucks";

const acmId = () => db.companies.find((c) => c.label === "ACM Logistics")!.id;
const truckId = (no: string) => db.trucks.find((t) => t.number === no)!.id;

beforeEach(() => {
  resetStore();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T06:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("trucks table", () => {
  it("shows each truck's current trip and why it can't be cancelled", async () => {
    const { rows } = await listTruckRows(acmId());
    const t = rows.find((r) => r.number === "BR01GN8331")!;
    expect(t.trip).toMatchObject({ lrNo: "19019", status: "In transit" });
    expect(t.cancelBlockedBy).toContain("LR 19019 (in transit)");
  });

  it("has no trip for a truck that hasn't been on an LR", async () => {
    const created = await createTruck(acmId(), { number: "RJ42GA1293" });
    const { rows } = await listTruckRows(acmId());
    const t = rows.find((r) => r.id === created.id)!;
    expect(t.trip).toBeNull();
    expect(t.cancelBlockedBy).toBeNull();
  });
});

describe("cancelling trucks and drivers", () => {
  it("refuses a truck on an undelivered LR", async () => {
    await expect(cancelTruck(acmId(), truckId("BR01GN8331"))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("allows it once the LR is delivered", async () => {
    const lr = db.lrs.find((l) => l.lrNo === "19019")!;
    lr.deliveredAt = "2026-10-20T00:00:00.000Z";
    const t = await cancelTruck(acmId(), truckId("BR01GN8331"));
    expect(t.cancelledAt).toBeDefined();
  });

  it("refuses a driver whose truck is on an undelivered LR", async () => {
    const { rows } = await listDriverRows(acmId());
    const d = rows.find((r) => r.mobile === "7870015869")!;
    expect(d.cancelBlockedBy).toContain("LR 19019");
    await expect(cancelDriver(acmId(), d.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("unlinks a cancelled driver from their trucks", async () => {
    const driver = await createDriver(acmId(), { mobile: "9876543210" });
    const truck = await createTruck(acmId(), { number: "RJ42GA1293", driverId: driver.id });
    await cancelDriver(acmId(), driver.id);
    expect(db.trucks.find((t) => t.id === truck.id)!.driverId).toBeNull();
  });
});

describe("driver link and invite", () => {
  it("assigns and clears a truck's driver through Truck.driverId", async () => {
    const driver = await createDriver(acmId(), { mobile: "9876543210" });
    const id = truckId("BR01GN8331");
    let truck = await updateTruck(acmId(), id, 1, { driverId: driver.id });
    expect(truck.driverMobile).toBe("9876543210");
    truck = await updateTruck(acmId(), id, truck.version, { driverId: "" });
    expect(truck.driverId).toBeNull();
  });

  it("rejects a second driver with the same mobile", async () => {
    await expect(createDriver(acmId(), { mobile: "7870015869" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("records when the driver was invited", async () => {
    const d = db.drivers.find((x) => x.mobile === "8873764100")!;
    expect(d.invitedAt).toBeNull();
    const invited = await inviteDriver(acmId(), d.id);
    expect(invited.invitedAt).toBe("2026-10-28T06:00:00.000Z");
  });
});

describe("expiry alerts", () => {
  it("lists expired and soon-to-lapse documents, soonest first, and feeds the dashboard", async () => {
    const t = await createTruck(acmId(), {
      number: "RJ42GA1293",
      rcExpiry: "2026-10-20", // expired
      insuranceExpiry: "2026-11-12", // 15 days left
      permitExpiry: "2026-11-13", // 16 days left: not yet
    });
    await createDriver(acmId(), { mobile: "9876543210", licenceExpiry: "2026-10-28" });
    const alerts = await listExpiryAlerts(acmId());
    expect(
      alerts.map((a) => (a.kind === "doc_expiry" ? `${a.ownerLabel} ${a.doc} ${a.daysLeft}` : "")),
    ).toEqual([`${t.number} RC -8`, "9876543210 Licence 0", `${t.number} Insurance 15`]);
    const dash = await getDashboard(acmId());
    expect(dash.attention.filter((a) => a.kind === "doc_expiry")).toHaveLength(3);
  });

  it("ignores cancelled trucks and unset dates", async () => {
    const t = await createTruck(acmId(), { number: "RJ42GA1293", rcExpiry: "2026-10-01" });
    await cancelTruck(acmId(), t.id);
    expect(await listExpiryAlerts(acmId())).toEqual([]);
  });
});

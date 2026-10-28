import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, type Action } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { setTestUser } from "@/lib/test-setup";
import { db, resetStore, SAMPLE_IDS } from "./_store";

// Tests run outside a Next.js request, where connection() would throw.
vi.mock("next/server", () => ({ connection: async () => {} }));
import * as bills from "./bills";
import * as companies from "./companies";
import { ForbiddenError } from "./errors";
import * as invoices from "./invoices";
import * as items from "./items";
import * as lrs from "./lrs";
import * as members from "./members";
import * as parties from "./parties";
import * as pod from "./pod";
import * as trucks from "./trucks";
import * as uploads from "./uploads";

const acmId = () => db.companies.find((c) => c.label === "ACM Logistics")!.id;
const ownerUserId = SAMPLE_IDS.ownerId;
const X = "00000000-0000-4000-8000-00000000ffff"; // an id that doesn't exist

/** The session user's role in ACM. */
function actAs(role: Role) {
  db.memberships.find((m) => m.companyId === acmId() && m.userId === ownerUserId)!.role = role;
  // Keep another Owner so "at least one Owner" never gets in the way of these tests.
  if (role !== "owner") {
    db.memberships.push({
      ...db.memberships.find((m) => m.userId === ownerUserId)!,
      id: "00000000-0000-4000-8000-00000000eeee",
      userId: "00000000-0000-4000-8000-00000000dddd",
      role: "owner",
    });
  }
}

beforeEach(() => resetStore());

// Every write function in lib/data, the action it needs and a call with throwaway arguments.
// The permission check runs first, so other failures (not found, validation) don't matter.
const c = () => acmId();
const png = { name: "a.png", type: "image/png", bytes: new Uint8Array([1]) };
const WRITES: Record<string, [Action, () => Promise<unknown>]> = {
  createFreightBill: ["bill.edit", () => bills.createFreightBill(c(), {} as never)],
  updateFreightBill: ["bill.edit", () => bills.updateFreightBill(c(), X, 1, {})],
  finaliseFreightBill: ["bill.edit", () => bills.finaliseFreightBill(c(), X, 1)],
  cancelFreightBill: ["record.cancel", () => bills.cancelFreightBill(c(), X)],
  createPayment: ["bill.edit", () => bills.createPayment(c(), {} as never)],
  updatePayment: ["bill.edit", () => bills.updatePayment(c(), X, 1, {} as never)],
  cancelPayment: ["record.cancel", () => bills.cancelPayment(c(), X)],
  updateCompany: ["company.manage", () => companies.updateCompany(c(), 1, {})],
  createTaxInvoice: ["invoice.edit", () => invoices.createTaxInvoice(c(), {} as never)],
  updateTaxInvoice: ["invoice.edit", () => invoices.updateTaxInvoice(c(), X, 1, {})],
  finaliseTaxInvoice: ["invoice.edit", () => invoices.finaliseTaxInvoice(c(), X, 1)],
  cancelTaxInvoice: ["record.cancel", () => invoices.cancelTaxInvoice(c(), X, "x" as never)],
  createItem: ["master.edit", () => items.createItem(c(), {} as never)],
  updateItem: ["master.edit", () => items.updateItem(c(), X, 1, {})],
  createLr: ["lr.edit", () => lrs.createLr(c(), {})],
  updateLr: ["lr.edit", () => lrs.updateLr(c(), X, 1, {})],
  bookLr: ["lr.edit", () => lrs.bookLr(c(), X, 1)],
  dispatchLr: ["lr.edit", () => lrs.dispatchLr(c(), X, 1)],
  cancelLr: ["record.cancel", () => lrs.cancelLr(c(), X, { reason: "x" })],
  changeMemberRole: ["company.manage", () => members.changeMemberRole(c(), X, 1, "owner")],
  removeMember: ["company.manage", () => members.removeMember(c(), X)],
  inviteMember: ["company.manage", () => members.inviteMember(c(), {} as never)],
  resetMemberPassword: ["company.manage", () => members.resetMemberPassword(c(), X)],
  createParty: ["master.edit", () => parties.createParty(c(), {} as never)],
  updateParty: ["master.edit", () => parties.updateParty(c(), X, 1, {})],
  cancelParty: ["record.cancel", () => parties.cancelParty(c(), X)],
  cancelPod: ["record.cancel", () => pod.cancelPod(c(), X)],
  createTruck: ["master.edit", () => trucks.createTruck(c(), {} as never)],
  updateTruck: ["master.edit", () => trucks.updateTruck(c(), X, 1, {})],
  cancelTruck: ["record.cancel", () => trucks.cancelTruck(c(), X)],
  createDriver: ["master.edit", () => trucks.createDriver(c(), {} as never)],
  updateDriver: ["master.edit", () => trucks.updateDriver(c(), X, 1, {})],
  cancelDriver: ["record.cancel", () => trucks.cancelDriver(c(), X)],
  inviteDriver: ["company.manage", () => trucks.inviteDriver(c(), X)],
  uploadCompanyImage: ["company.manage", () => uploads.uploadCompanyImage(c(), "logo", png)],
  // POD: own-trip rules are tested separately below.
  createPod: ["pod.upload", () => pod.createPod(c(), { lrId: X } as never)],
  updatePod: ["pod.upload", () => pod.updatePod(c(), X, 1, {})],
  uploadPodFile: ["pod.upload", () => uploads.uploadPodFile(c(), png)],
};

/** Resolves to true when the call was refused for permissions. */
const refused = (call: () => Promise<unknown>) =>
  call().then(
    () => false,
    (e) => e instanceof ForbiddenError,
  );

describe("every lib/data write checks lib/permissions", () => {
  it("covers every exported write function", () => {
    const dir = __dirname;
    const found = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .flatMap((f) =>
        [
          ...readFileSync(join(dir, f), "utf8").matchAll(
            /export async function ((?:create|update|cancel|book|dispatch|finalise|invite|upload|change|remove|delete|set|reset)\w*)/g,
          ),
        ].map((m) => m[1]),
      )
      // Not company-scoped: any user may add a company (they become its Owner) or switch to one.
      .filter((n) => n !== "createCompany" && n !== "setActiveCompany");
    expect(found.sort()).toEqual(Object.keys(WRITES).sort());
  });

  const roles: Role[] = ["owner", "accountant", "booking_staff"];
  for (const role of roles) {
    it.each(Object.entries(WRITES))(`${role}: %s`, async (_name, [action, call]) => {
      actAs(role);
      const allowed = can(role, action) || (action === "pod.upload" && can(role, "pod.upload_own"));
      expect(await refused(call)).toBe(!allowed);
    });
  }

  it("sends logged-out visitors to /login", async () => {
    await setTestUser(null);
    await expect(lrs.createLr(acmId(), {})).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("refuses users who aren't members of the company", async () => {
    // The sample Owner leaves ACM but stays signed in through RS Logistics.
    db.memberships.find((m) => m.companyId === acmId() && m.userId === ownerUserId)!.cancelledAt =
      "2026-10-01T00:00:00.000Z";
    await expect(lrs.createLr(acmId(), {})).rejects.toThrow("You're not a member of this company.");
  });

  it("says which role was refused", async () => {
    actAs("accountant");
    await expect(lrs.createLr(acmId(), {})).rejects.toThrow(
      "Your role (Accountant) can't create or edit LRs.",
    );
  });
});

describe("drivers: POD on their own trips only", () => {
  const driverUser = () => db.memberships.find((m) => m.role === "driver")!.userId;
  const lrId = (no: string) => db.lrs.find((l) => l.lrNo === no)!.id;

  it("records POD on their own trip, not on someone else's", async () => {
    await setTestUser(driverUser());
    const saved = await pod.createPod(acmId(), { lrId: lrId("19019"), deliveredOn: "2026-10-20" });
    expect(saved.lrId).toBe(lrId("19019"));
    await expect(
      pod.createPod(acmId(), { lrId: lrId("19020"), deliveredOn: "2026-10-20" }),
    ).rejects.toThrow("Drivers can only record POD for their own trips.");
  });

  it("can upload a POD photo but nothing else", async () => {
    await setTestUser(driverUser());
    await expect(uploads.uploadPodFile(acmId(), png)).resolves.toMatchObject({ name: "a.png" });
    await expect(lrs.createLr(acmId(), {})).rejects.toThrow(ForbiddenError);
    await expect(pod.cancelPod(acmId(), X)).rejects.toThrow(ForbiddenError);
  });
});

describe("a company keeps at least one Owner", () => {
  const ownerMembership = () =>
    db.memberships.find((m) => m.companyId === acmId() && m.role === "owner")!;

  it("won't demote or remove the last Owner", async () => {
    const m = ownerMembership();
    await expect(members.changeMemberRole(acmId(), m.id, m.version, "accountant")).rejects.toThrow(
      members.LAST_OWNER_MESSAGE,
    );
    await expect(members.removeMember(acmId(), m.id)).rejects.toThrow(members.LAST_OWNER_MESSAGE);
  });

  it("allows it once someone else is Owner", async () => {
    const staff = db.memberships.find(
      (m) => m.companyId === acmId() && m.role === "booking_staff",
    )!;
    await members.changeMemberRole(acmId(), staff.id, staff.version, "owner");
    const me = ownerMembership();
    const demoted = await members.changeMemberRole(acmId(), me.id, me.version, "accountant");
    expect(demoted.role).toBe("accountant");
    // I'm no longer Owner, so I can't manage users at all…
    await expect(members.removeMember(acmId(), staff.id)).rejects.toThrow(ForbiddenError);
    // …and the new Owner can't remove themselves: they're the last one.
    await setTestUser(staff.userId);
    await expect(members.removeMember(acmId(), staff.id)).rejects.toThrow(
      members.LAST_OWNER_MESSAGE,
    );
  });

  it("counts only active Owners", async () => {
    const staff = db.memberships.find(
      (m) => m.companyId === acmId() && m.role === "booking_staff",
    )!;
    await members.changeMemberRole(acmId(), staff.id, staff.version, "owner");
    await members.removeMember(acmId(), staff.id);
    const me = ownerMembership();
    await expect(members.removeMember(acmId(), me.id)).rejects.toThrow(members.LAST_OWNER_MESSAGE);
  });

  it("other roles can change freely while an Owner remains", async () => {
    const staff = db.memberships.find(
      (m) => m.companyId === acmId() && m.role === "booking_staff",
    )!;
    const saved = await members.changeMemberRole(acmId(), staff.id, staff.version, "accountant");
    expect(saved.role).toBe("accountant");
    await expect(members.removeMember(acmId(), staff.id)).resolves.toMatchObject({
      cancelledAt: expect.any(String),
    });
  });
});

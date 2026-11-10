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
import * as challans from "./challans";
import * as companies from "./companies";
import { ForbiddenError } from "./errors";
import * as hireMasters from "./hire-masters";
import * as hireSettings from "./hire-settings";
import * as marketDrivers from "./market-drivers";
import * as marketVehicles from "./market-vehicles";
import * as truckParties from "./truck-parties";
import * as imports from "./import";
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
const png8 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]);
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
  createImportedLr: ["lr.edit", () => lrs.createImportedLr(c(), {}, "19100", X, "")],
  createImportBatch: [
    "import.run",
    () => imports.createImportBatch(c(), { source: "document", fileName: "a.png", bytes: png8 }),
  ],
  removeImportBatch: ["import.run", () => imports.removeImportBatch(c(), X)],
  setColumnMapping: ["import.run", () => imports.setColumnMapping(c(), X, "LR No", "lr_no")],
  setRowAction: ["import.run", () => imports.setRowAction(c(), X, 4, "skip")],
  saveImportMapping: ["import.run", () => imports.saveImportMapping(c(), X, "Mapping")],
  applyImportMapping: ["import.run", () => imports.applyImportMapping(c(), X, X)],
  // Also needs lr.edit (it creates LRs), so an Accountant is refused.
  commitExcelBatch: ["lr.edit", () => imports.commitExcelBatch(c(), X)],
  saveImportedInvoice: [
    "import.run",
    () =>
      imports.saveImportedInvoice(c(), {
        batchId: X,
        input: {} as never,
        pending: { parties: {}, trucks: {} },
      }),
  ],
  uploadImportFile: [
    "import.run",
    () => uploads.uploadImportFile(c(), { name: "a.png", format: "png", bytes: png8 }),
  ],
  updateLr: ["lr.edit", () => lrs.updateLr(c(), X, 1, {})],
  bookLr: ["lr.edit", () => lrs.bookLr(c(), X, 1)],
  dispatchLr: ["lr.edit", () => lrs.dispatchLr(c(), X, 1)],
  dispatchLrOnChallan: ["lr.edit", () => lrs.dispatchLrOnChallan(c(), X, X)],
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
  // Tier 1 (market trucks): masters need master.edit, challans need lr.edit.
  createVehicleType: ["master.edit", () => hireMasters.createVehicleType(c(), {} as never)],
  updateVehicleType: ["master.edit", () => hireMasters.updateVehicleType(c(), X, 1, {})],
  createChargeType: ["master.edit", () => hireMasters.createChargeType(c(), {} as never)],
  updateChargeType: ["master.edit", () => hireMasters.updateChargeType(c(), X, 1, {})],
  createPump: ["master.edit", () => hireMasters.createPump(c(), {} as never)],
  updatePump: ["master.edit", () => hireMasters.updatePump(c(), X, 1, {})],
  createBranch: ["master.edit", () => hireMasters.createBranch(c(), {} as never)],
  updateBranch: ["master.edit", () => hireMasters.updateBranch(c(), X, 1, {})],
  createHireSeries: ["master.edit", () => hireMasters.createHireSeries(c(), {} as never)],
  updateHireSeries: ["master.edit", () => hireMasters.updateHireSeries(c(), "challan" as never, {} as never)],
  uploadTruckDoc: ["master.edit", () => uploads.uploadTruckDoc(c(), "rc", png)],
  updateHireSettings: ["company.manage", () => hireSettings.updateHireSettings(c(), 1, {} as never)],
  createMarketVehicle: ["master.edit", () => marketVehicles.createMarketVehicle(c(), {} as never)],
  updateMarketVehicle: ["master.edit", () => marketVehicles.updateMarketVehicle(c(), X, 1, {})],
  createMarketDriver: ["master.edit", () => marketDrivers.createMarketDriver(c(), {} as never)],
  updateMarketDriver: ["master.edit", () => marketDrivers.updateMarketDriver(c(), X, 1, {})],
  createTruckParty: ["master.edit", () => truckParties.createTruckParty(c(), {} as never)],
  updateTruckParty: ["master.edit", () => truckParties.updateTruckParty(c(), X, 1, {})],
  saveChallan: ["lr.edit", () => challans.saveChallan(c(), null, null, {} as never)],
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
            /export async function ((?:create|update|cancel|book|dispatch|finalise|invite|upload|change|remove|delete|set|reset|save|apply|commit)\w*)/g,
          ),
        ].map((m) => m[1]),
      );
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

  // Bank / UPI / verified / blacklist on truck parties need payee.bank (Owner + Accountant only);
  // any other truck-party edit only needs master.edit.
  const BANK_PATCHES: Record<string, object> = {
    bankName: { bankName: "HDFC" },
    accountHolder: { accountHolder: "A B" },
    accountNo: { accountNo: "123456789" },
    ifsc: { ifsc: "HDFC0001234" },
    upiId: { upiId: "a@b" },
    upiQrUrl: { upiQrUrl: null },
    verified: { verified: true },
    status: { status: "blacklisted", blacklistReason: "x" },
  };
  for (const role of roles) {
    const bank = can(role, "payee.bank");
    it.each(Object.entries(BANK_PATCHES))(`${role}: truck party %s change`, async (_k, patch) => {
      actAs(role);
      expect(await refused(() => truckParties.updateTruckParty(c(), X, 1, patch as never))).toBe(!bank);
    });
    it(`${role}: truck party bank details on create`, async () => {
      actAs(role);
      expect(
        await refused(() =>
          truckParties.createTruckParty(c(), { role: "owner", name: "TEST", bankName: "HDFC" } as never),
        ),
      ).toBe(!bank);
    });
    it(`${role}: other truck party edits only need master.edit`, async () => {
      actAs(role);
      expect(await refused(() => truckParties.updateTruckParty(c(), X, 1, { notes: "x" }))).toBe(false);
    });
  }

  it("payee.bank is Owner + Accountant only", () => {
    expect(can("owner", "payee.bank")).toBe(true);
    expect(can("accountant", "payee.bank")).toBe(true);
    expect(can("booking_staff", "payee.bank")).toBe(false);
    expect(can("driver", "payee.bank")).toBe(false);
  });

  it("sends logged-out visitors to /login", async () => {
    await setTestUser(null);
    await expect(lrs.createLr(acmId(), {})).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("refuses users who aren't members of the company", async () => {
    // The RS owner is signed in, but belongs to RS Logistics only.
    await setTestUser(db.users.find((u) => u.name === "RS Owner")!.id);
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

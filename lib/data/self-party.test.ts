import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetStore } from "./_store";

vi.mock("next/server", () => ({ connection: async () => {} }));
import { updateCompany } from "./companies";
import { ValidationError } from "./errors";
import { createLr } from "./lrs";
import { cancelParty, getSelfParty, listParties, updateParty } from "./parties";

const acm = () => db.companies.find((c) => c.label === "ACM Logistics")!;
const rs = () => db.companies.find((c) => c.label === "RS Logistics")!;
const selfRows = (companyId: string) =>
  db.parties.filter((p) => p.companyId === companyId && p.isSelf);

beforeEach(() => resetStore());

describe("self party", () => {
  it("exists once per company, copied from the Company profile", async () => {
    expect(selfRows(acm().id)).toHaveLength(1);
    expect(selfRows(rs().id)).toHaveLength(1);
    const self = await getSelfParty(acm().id);
    expect(self).toMatchObject({
      isSelf: true,
      name: "ACM LOGISTICS",
      place: "Patna",
      gstin: "10AAXFA2859G1ZD",
      pan: "AAXFA2859G",
      phone: "7070191216",
      stateCode: "10",
      pincode: "800026",
    });
    expect(self.address).toBe(acm().office);
    // getSelfParty never makes a second one.
    await getSelfParty(acm().id);
    expect(selfRows(acm().id)).toHaveLength(1);
  });

  it("follows Company profile edits (name, GSTIN, address, phone) and writes audit", async () => {
    const before = await getSelfParty(rs().id);
    await updateCompany(rs().id, rs().version, {
      name: "RS LOGISTICS PVT LTD",
      office: "New Office, Sector 4, Bokaro - 827004",
      mobile1: "9123456780",
      gstin: "20ABLFR4565P1ZN",
    });
    const after = await getSelfParty(rs().id);
    expect(after).toMatchObject({
      id: before.id,
      name: "RS LOGISTICS PVT LTD",
      address: "New Office, Sector 4, Bokaro - 827004",
      phone: "9123456780",
      pincode: "827004",
      version: before.version + 1,
    });
    expect(
      db.audit.some(
        (a) => a.table === "parties" && a.recordId === before.id && a.action === "update",
      ),
    ).toBe(true);
  });

  it("can't be edited or cancelled from Parties", async () => {
    const self = await getSelfParty(acm().id);
    await expect(updateParty(acm().id, self.id, self.version, { name: "X" })).rejects.toThrow(
      "Company profile",
    );
    await expect(cancelParty(acm().id, self.id, "no")).rejects.toThrow(ValidationError);
  });

  it("can be consignor, consignee or billed-to on an LR and shows in party lists", async () => {
    const self = await getSelfParty(acm().id);
    const lr = await createLr(acm().id, {
      consignorId: self.id,
      consigneeId: self.id,
      billedToId: self.id,
    });
    expect(lr.consignorId).toBe(self.id);
    expect((await listParties(acm().id, { search: "acm" })).rows.map((p) => p.id)).toContain(
      self.id,
    );
  });
});

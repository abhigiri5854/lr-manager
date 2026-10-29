// lib/data on the database (DATA_SOURCE=db, prompt 19a): the real lib/data functions, signed in
// through the session cookie, against the dev database. Each test makes its own companies/users.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Fixtures, connect, type Sql } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

process.env.DATA_SOURCE = "db";

const session = await import("@/lib/data/session");
const parties = await import("@/lib/data/parties");
const items = await import("@/lib/data/items");
const trucks = await import("@/lib/data/trucks");
const companies = await import("@/lib/data/companies");
const members = await import("@/lib/data/members");
const { ConflictError, ForbiddenError, NotOnDatabaseError, ValidationError } =
  await import("@/lib/data/errors");

let sql: Sql;
let fx: Fixtures;

beforeAll(() => {
  sql = connect();
  fx = new Fixtures(sql);
});
afterEach(() => fx.cleanup());
afterAll(async () => {
  await sql.end();
  const g = globalThis as { __lrmSql?: { end: () => Promise<void> } };
  await g.__lrmSql?.end();
});

function signIn(userId: string, companyId?: string) {
  jar.clear();
  jar.set(session.SESSION_COOKIE, session.sessionCookieValue(userId));
  if (companyId) jar.set("lrm_company", companyId);
}

const party = (name: string) => ({ name, place: "Patna", phone: "9123456780" });

describe("lib/data on the database", () => {
  it("session: user and memberships come from the database", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    expect(await session.getSessionUserId()).toBe(t.staff);
    expect(await session.getActiveCompanyId()).toBe(t.companyId);
    expect(await session.getRole(t.companyId)).toBe("booking_staff");
    const loner = await fx.user("No company");
    signIn(loner);
    expect(await session.getSessionUserId()).toBeNull();
  });

  it("parties: create, SQL search + paging, version conflict, audit rows", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const p = await parties.createParty(t.companyId, party("Zeta Search Traders"));
    await parties.createParty(t.companyId, party("Other Name"));

    const found = await parties.listParties(t.companyId, { search: "zeta search" });
    expect(found.rows.map((r) => r.id)).toEqual([p.id]);
    const page = await parties.listParties(t.companyId, { pageSize: 1, page: 2 });
    expect(page.total).toBe(3); // two + the self party
    expect(page.rows).toHaveLength(1);

    const saved = await parties.updateParty(t.companyId, p.id, p.version, { pincode: "800001" });
    expect(saved.version).toBe(p.version + 1);
    await expect(
      parties.updateParty(t.companyId, p.id, p.version, { pincode: "800002" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const audit = await sql`select action, user_id from audit_log
                             where record_id = ${p.id} order by created_at`;
    expect(audit.map((a) => a.action)).toEqual(["create", "update"]);
    expect(audit.every((a) => a.user_id === t.owner)).toBe(true);
  });

  it("another company's data is invisible and can't be written (RLS behind assertCan)", async () => {
    const a = await fx.team();
    const b = await fx.team();
    const bParty = await fx.party(b.companyId, "B only");
    signIn(a.owner, a.companyId);
    expect((await parties.listParties(b.companyId)).rows).toEqual([]);
    expect(await parties.getPartyById(b.companyId, bParty)).toBeNull();
    await expect(parties.createParty(b.companyId, party("Sneaky"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("roles: staff can edit masters but not cancel; cancel is blocked while a live LR uses it", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    const p = await parties.createParty(t.companyId, party("Used Party"));
    await expect(parties.cancelParty(t.companyId, p.id)).rejects.toBeInstanceOf(ForbiddenError);
    await fx.bookedLr(t.companyId, { consignorId: p.id });
    signIn(t.owner, t.companyId);
    await expect(parties.cancelParty(t.companyId, p.id)).rejects.toThrow(/Used on 1 LR/);
    const free = await parties.createParty(t.companyId, party("Free Party"));
    const cancelled = await parties.cancelParty(t.companyId, free.id, "duplicate");
    expect(cancelled.cancelledAt).toBeTruthy();
    expect(cancelled.cancelReason).toBe("duplicate");
  });

  it("items: 40% GST is accepted; codes are unique case-insensitively", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const i = await items.createItem(t.companyId, { code: "ZT-1", name: "Pipe", gstRateBp: 4000 });
    expect(i.gstRateBp).toBe(4000);
    await expect(
      items.createItem(t.companyId, { code: "zt-1", name: "Again" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await items.searchItems(t.companyId, "zt")).map((x) => x.id)).toEqual([i.id]);
  });

  it("trucks: normalised unique number, trip and cancel rule from LRs", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const truck = await trucks.createTruck(t.companyId, { number: "br 02 ab 1234" });
    expect(truck.number).toBe("BR02AB1234");
    await expect(trucks.createTruck(t.companyId, { number: "BR02AB1234" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await fx.bookedLr(t.companyId, { lrNo: "777", truckId: truck.id });
    const [row] = (await trucks.listTruckRows(t.companyId, { search: "BR02" })).rows;
    expect(row.trip).toMatchObject({ lrNo: "777", status: "Booked" });
    expect(row.cancelBlockedBy).toMatch(/LR 777/);
    await expect(trucks.cancelTruck(t.companyId, truck.id)).rejects.toThrow(/LR 777/);
  });

  it("company profile: LR series only moves forward; members list from the database", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const c = (await companies.getCompany(t.companyId))!;
    const saved = await companies.updateCompany(t.companyId, c.version, {
      // Fixture companies get a random GSTIN; the profile rule wants the PAN inside it.
      pan: c.gstin.slice(2, 12),
      signatoryName: "Test Signatory",
      nextLrNo: 500,
    });
    expect(saved.nextLrNo).toBe(500);
    expect(saved.signatoryName).toBe("Test Signatory");
    await expect(
      companies.updateCompany(t.companyId, saved.version, { nextLrNo: 10 }),
    ).rejects.toThrow(/Can't go below 500/);
    const rows = await members.listMemberRows(t.companyId);
    expect(rows.map((r) => r.role).sort()).toEqual([
      "accountant",
      "booking_staff",
      "driver",
      "owner",
    ]);
  });

  it("areas not on the database yet refuse instead of showing sample data", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const { listLrs } = await import("@/lib/data/lrs");
    await expect(listLrs(t.companyId, {})).rejects.toBeInstanceOf(NotOnDatabaseError);
  });
});

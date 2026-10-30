// One login = one company: the DB refuses a second membership, the login lookup is scoped by the
// company code, and a user of company A can't reach company B even with a forged company id.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { as, connect, Fixtures, pgError, type Sql } from "./helpers";

let sql: Sql;
let fx: Fixtures;

beforeAll(() => {
  sql = connect();
  fx = new Fixtures(sql);
});
afterEach(() => fx.cleanup());
afterAll(() => sql.end());

async function twoCompanies() {
  const ownerA = await fx.user("Owner A");
  const ownerB = await fx.user("Owner B");
  const a = await fx.company(ownerA);
  const b = await fx.company(ownerB);
  return { ownerA, ownerB, a, b };
}

describe("one active membership per user", () => {
  it("refuses a second company for the same login", async () => {
    const { ownerA, b } = await twoCompanies();
    const err = await pgError(fx.member(b, ownerA, "accountant"));
    expect(err.code).toBe("23505");
  });

  it("allows a new company after the first membership is cancelled", async () => {
    const owner = await fx.user("Owner");
    const a = await fx.company(owner);
    const staff = await fx.user("Staff");
    await fx.member(a, staff, "booking_staff");
    await sql`update memberships set cancelled_at = now() where company_id = ${a} and user_id = ${staff}`;
    const b = await fx.company(await fx.user("Owner B"));
    await fx.member(b, staff, "booking_staff");
    const [u] = await sql`select company_id from users where id = ${staff}`;
    expect(u.company_id).toBe(b);
  });
});

describe("app.login_lookup", () => {
  it("finds a person only under their own company's code (same answer otherwise)", async () => {
    const { ownerA, a, b } = await twoCompanies();
    const mobile = "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
    await sql`update users set mobile = ${mobile} where id = ${ownerA}`;
    const [{ code: codeA }] = await sql`select code from companies where id = ${a}`;
    const [{ code: codeB }] = await sql`select code from companies where id = ${b}`;
    const find = (code: string, who: string) =>
      sql`select user_id from app.login_lookup(${code}, ${who})`;
    expect((await find(codeA, mobile)).map((r) => r.user_id)).toEqual([ownerA]);
    expect((await find(codeA.toLowerCase(), mobile)).map((r) => r.user_id)).toEqual([ownerA]);
    expect(await find(codeB, mobile)).toHaveLength(0);
    expect(await find("NOSUCH", mobile)).toHaveLength(0);
  });

  it("lets the same mobile exist in two companies", async () => {
    const { ownerA, ownerB, a, b } = await twoCompanies();
    const mobile = "8" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
    await sql`update users set mobile = ${mobile} where id = ${ownerA}`;
    await sql`update users set mobile = ${mobile} where id = ${ownerB}`;
    const [{ code: codeB }] = await sql`select code from companies where id = ${b}`;
    const rows = await sql`select user_id from app.login_lookup(${codeB}, ${mobile})`;
    expect(rows.map((r) => r.user_id)).toEqual([ownerB]);
    expect(a).not.toBe(b);
  });
});

describe("forged company id", () => {
  it("A's user can't read or write B's rows, whatever company id is claimed or inserted", async () => {
    const { ownerA, a, b } = await twoCompanies();
    const partyB = await fx.party(b, "B's customer");
    const lrB = await fx.bookedLr(b, { consignorId: partyB });
    await as(sql, ownerA, async (tx) => {
      // A claim naming company B changes nothing: RLS goes by membership.
      const claims = JSON.stringify({ sub: ownerA, role: "authenticated", company_id: b });
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
      expect(await tx`select id from lrs where company_id = ${b}`).toHaveLength(0);
      expect(await tx`select id from parties where company_id = ${b}`).toHaveLength(0);
      expect(await tx`select id from companies where id = ${b}`).toHaveLength(0);
      expect(await tx`select id from memberships where company_id = ${b}`).toHaveLength(0);
      expect(await tx`select id from lrs where id = ${lrB}`).toHaveLength(0);
    });
    // Writes: update B's rows touches nothing, insert with B's company id is refused.
    await as(sql, ownerA, async (tx) => {
      const upd = await tx`update parties set name = 'hacked' where company_id = ${b} returning id`;
      expect(upd).toHaveLength(0);
    });
    const err = await pgError(
      as(sql, ownerA, (tx) =>
        tx`insert into parties (company_id, name, state_code) values (${b}, 'Sneaky', '10')`,
      ),
    );
    expect(err.code).toBe("42501");
    const err2 = await pgError(
      as(sql, ownerA, (tx) =>
        tx`insert into memberships (company_id, user_id, role) values (${b}, ${ownerA}, 'owner')`,
      ),
    );
    expect(err2.code).toBe("42501");
    // A's own data is still reachable.
    await as(sql, ownerA, async (tx) => {
      expect((await tx`select id from companies`).map((r) => r.id)).toEqual([a]);
    });
    const [p] = await sql`select name from parties where id = ${partyB}`;
    expect(p.name).toBe("B's customer");
  });
});

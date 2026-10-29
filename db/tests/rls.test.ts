// A user of company A can neither read nor write company B's rows.
import { sql as dsql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb } from "../client";
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
  const partyB = await fx.party(b, "B's customer");
  const lrB = await fx.bookedLr(b, { consignorId: partyB });
  return { ownerA, ownerB, a, b, partyB, lrB };
}

describe("RLS: company isolation", () => {
  it("A's owner reads only A's rows, in every company-scoped table", async () => {
    const { ownerA, a, b } = await twoCompanies();
    await as(sql, ownerA, async (tx) => {
      const companies = await tx`select id from companies`;
      expect(companies.map((r) => r.id)).toEqual([a]);
      for (const table of [
        "parties",
        "lrs",
        "memberships",
        "number_series",
        "audit_log",
        "freight_bills",
        "trucks",
      ]) {
        const rows = await tx`select company_id from ${tx(table)} where company_id = ${b}`;
        expect(rows, table).toHaveLength(0);
      }
      // A only sees A's self party.
      const parties = await tx`select company_id, is_self from parties`;
      expect(parties).toEqual([{ company_id: a, is_self: true }]);
    });
  });

  it("works the same through db/client asUser (drizzle, pooler, prepare: false)", async () => {
    const { ownerA, ownerB, b } = await twoCompanies();
    const db = createDb(sql);
    const seenByA = await asUser(db, { sub: ownerA }, (tx) =>
      tx.execute(dsql`select id from lrs where company_id = ${b}`),
    );
    expect(seenByA).toHaveLength(0);
    const seenByB = await asUser(db, { sub: ownerB }, (tx) =>
      tx.execute(dsql`select id from lrs where company_id = ${b}`),
    );
    expect(seenByB).toHaveLength(1);
  });

  it("A's owner can't insert into B", async () => {
    const { ownerA, b } = await twoCompanies();
    const e = await pgError(
      as(sql, ownerA, (tx) => tx`insert into parties (company_id, name) values (${b}, 'Sneaky')`),
    );
    expect(e.code).toBe("42501"); // row-level security violation
  });

  it("A's owner can't update or cancel B's rows (they are invisible: 0 rows)", async () => {
    const { ownerA, partyB, lrB } = await twoCompanies();
    await as(sql, ownerA, async (tx) => {
      expect((await tx`update parties set name = 'Hacked' where id = ${partyB}`).count).toBe(0);
      expect((await tx`update lrs set cancelled_at = now() where id = ${lrB}`).count).toBe(0);
    });
    const [p] = await sql`select name from parties where id = ${partyB}`;
    expect(p.name).toBe("B's customer");
  });

  it("A's owner can't move a row into B", async () => {
    const { ownerA, a, b } = await twoCompanies();
    const partyA = await fx.party(a);
    const e = await pgError(
      as(sql, ownerA, (tx) => tx`update parties set company_id = ${b} where id = ${partyA}`),
    );
    expect(e.code).toBe("42501");
  });

  it("composite FKs stop a row in A pointing at B's party, even for the system", async () => {
    const { a, partyB } = await twoCompanies();
    const e = await pgError(fx.bookedLr(a, { consignorId: partyB }));
    expect(e.code).toBe("23503"); // foreign key violation
  });

  it("A's owner can't take B's document numbers or read B's series", async () => {
    const { ownerA, b } = await twoCompanies();
    const e = await pgError(
      as(sql, ownerA, (tx) => tx`select * from app.allocate_number(${b}, 'freight_bill', '2026-27')`),
    );
    expect(e.code).toBe("42501");
    const [peek] = await as(sql, ownerA, (tx) => tx`select app.peek_number(${b}, 'lr', '2026-27') as n`);
    expect(peek.n).toBeNull();
  });

  it("B's users are invisible to A, and A can't add itself to B", async () => {
    const { ownerA, ownerB, b } = await twoCompanies();
    const seen = await as(sql, ownerA, (tx) => tx`select id from users where id = ${ownerB}`);
    expect(seen).toHaveLength(0);
    const e = await pgError(
      as(
        sql,
        ownerA,
        (tx) => tx`insert into memberships (company_id, user_id, role) values (${b}, ${ownerA}, 'owner')`,
      ),
    );
    expect(e.code).toBe("42501");
  });

  it("anon can read nothing", async () => {
    const { b } = await twoCompanies();
    const e = await pgError(
      sql.begin(async (tx) => {
        await tx`set local role anon`;
        return tx`select id from lrs where company_id = ${b}`;
      }),
    );
    expect(e.code).toBe("42501"); // permission denied for table
  });
});

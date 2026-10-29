// audit_log is append-only; business rows are never hard-deleted.
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

async function withAuditRow() {
  const t = await fx.team();
  const party = await fx.party(t.companyId);
  const [row] = await as(
    sql,
    t.staff,
    (tx) => tx`insert into audit_log (company_id, actor, user_id, table_name, record_id, action, changes)
               values (${t.companyId}, 'user', ${t.staff}, 'parties', ${party}, 'update',
                       '[{"field":"name","old":"A","new":"B"}]'::jsonb)
               returning id`,
  );
  return { ...t, party, auditId: row.id as string };
}

describe("audit_log", () => {
  it("a member writes rows as themselves and office roles read them", async () => {
    const t = await withAuditRow();
    const seen = await as(sql, t.owner, (tx) => tx`select user_id from audit_log where id = ${t.auditId}`);
    expect(seen).toEqual([{ user_id: t.staff }]);
  });

  it("can't be written as someone else", async () => {
    const t = await withAuditRow();
    const e = await pgError(
      as(sql, t.staff, (tx) => tx`insert into audit_log (company_id, actor, user_id, table_name, record_id, action)
                                 values (${t.companyId}, 'user', ${t.owner}, 'parties', ${t.party}, 'update')`),
    );
    expect(e.code).toBe("42501");
  });

  it("system rows need a batch the writer created; actor and user_id must agree", async () => {
    const t = await withAuditRow();
    const e = await pgError(
      as(sql, t.staff, (tx) => tx`insert into audit_log (company_id, actor, table_name, record_id, action)
                                 values (${t.companyId}, 'system', 'parties', ${t.party}, 'create')`),
    );
    expect(e.code).toBe("42501");
    const e2 = await pgError(
      sql`insert into audit_log (company_id, actor, user_id, table_name, record_id, action)
          values (${t.companyId}, 'system', ${t.staff}, 'parties', ${t.party}, 'create')`,
    );
    expect(e2.code).toBe("23514");
  });

  it("can't be updated or deleted by a user (not even the owner)", async () => {
    const t = await withAuditRow();
    for (const q of [
      `update audit_log set changes = '[]'::jsonb where id = $1`,
      `delete from audit_log where id = $1`,
    ]) {
      const e = await pgError(as(sql, t.owner, (tx) => tx.unsafe(q, [t.auditId])));
      expect(e.code, q).toBe("42501");
    }
  });

  it("can't be updated or deleted even by the database owner role", async () => {
    const t = await withAuditRow();
    expect(
      (await pgError(sql`update audit_log set changes = '[]'::jsonb where id = ${t.auditId}`)).message,
    ).toMatch(/append-only/);
    expect((await pgError(sql`delete from audit_log where id = ${t.auditId}`)).message).toMatch(/append-only/);
    const [still] = await sql`select changes from audit_log where id = ${t.auditId}`;
    expect(still.changes).toEqual([{ field: "name", old: "A", new: "B" }]);
  });
});

describe("no hard deletes", () => {
  it("business rows can't be deleted, by users or the owner role; cancel instead", async () => {
    const t = await withAuditRow();
    const lr = await fx.bookedLr(t.companyId);
    const userDelete = await pgError(as(sql, t.owner, (tx) => tx`delete from parties where id = ${t.party}`));
    expect(userDelete.code).toBe("42501");
    for (const [table, id] of [
      ["parties", t.party],
      ["lrs", lr],
      ["companies", t.companyId],
    ] as const) {
      const e = await pgError(sql`delete from ${sql(table)} where id = ${id}`);
      expect(e.message, table).toMatch(/never deleted/);
    }
  });

  it("draft lines may be replaced, but not once the bill is final", async () => {
    const t = await withAuditRow();
    const party = await fx.party(t.companyId);
    const lr = await fx.bookedLr(t.companyId);
    const bill = await fx.finalBill(t.companyId, party, [lr], 1000);
    const r = await as(sql, t.owner, (tx) => tx`delete from freight_bill_lines where freight_bill_id = ${bill}`);
    expect(r.count).toBe(0);
  });
});

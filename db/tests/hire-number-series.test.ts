// Hire masters -> Number series: Owner can create / edit in their own company, others can't (0019).
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

async function branch(companyId: string): Promise<string> {
  const [b] = await sql`insert into branches (company_id, name) values (${companyId}, 'Main') returning id`;
  return b.id as string;
}

describe("hire_number_series privileges", () => {
  it("owner can create and edit a series in their company", async () => {
    const t = await fx.team();
    const branchId = await branch(t.companyId);
    await as(
      sql,
      t.owner,
      (tx) => tx`insert into hire_number_series (company_id, doc_type, branch_id, fy, prefix, next_no, padding)
                 values (${t.companyId}, 'challan', ${branchId}, '2026-27', 'CH/', 5, 4)`,
    );
    await as(
      sql,
      t.owner,
      (tx) => tx`update hire_number_series set prefix = 'CHL/', next_no = 10
                  where company_id = ${t.companyId} and branch_id = ${branchId} and doc_type = 'challan'`,
    );
    const [row] = await sql`select prefix, next_no from hire_number_series
                             where company_id = ${t.companyId} and branch_id = ${branchId} and doc_type = 'challan'`;
    expect(row.prefix).toBe("CHL/");
    expect(Number(row.next_no)).toBe(10);
  });

  it("staff in the same company can read but not create or edit", async () => {
    const t = await fx.team();
    const branchId = await branch(t.companyId);
    await sql`insert into hire_number_series (company_id, doc_type, branch_id, fy)
              values (${t.companyId}, 'challan', ${branchId}, '2026-27')`;
    const seen = await as(sql, t.staff, (tx) => tx`select 1 from hire_number_series where company_id = ${t.companyId}`);
    expect(seen.length).toBe(1);
    const e = await pgError(
      as(sql, t.staff, (tx) => tx`update hire_number_series set prefix = 'X/' where company_id = ${t.companyId}`),
    );
    expect(e.code).toBe("42501");
    const e2 = await pgError(
      as(
        sql,
        t.staff,
        (tx) => tx`insert into hire_number_series (company_id, doc_type, branch_id, fy)
                   values (${t.companyId}, 'truck_payment', ${branchId}, '2026-27')`,
      ),
    );
    expect(e2.code).toBe("42501");
  });

  it("a user of another company can't see or edit it", async () => {
    const a = await fx.team();
    const b = await fx.team();
    const branchId = await branch(a.companyId);
    await sql`insert into hire_number_series (company_id, doc_type, branch_id, fy, prefix)
              values (${a.companyId}, 'challan', ${branchId}, '2026-27', 'A/')`;

    const seen = await as(sql, b.owner, (tx) => tx`select 1 from hire_number_series where company_id = ${a.companyId}`);
    expect(seen.length).toBe(0);

    // RLS hides the row, so the update matches nothing
    await as(sql, b.owner, (tx) => tx`update hire_number_series set prefix = 'HACK/' where company_id = ${a.companyId}`);
    const [row] = await sql`select prefix from hire_number_series where company_id = ${a.companyId} and branch_id = ${branchId}`;
    expect(row.prefix).toBe("A/");

    // and can't insert into it
    const e = await pgError(
      as(
        sql,
        b.owner,
        (tx) => tx`insert into hire_number_series (company_id, doc_type, branch_id, fy)
                   values (${a.companyId}, 'truck_payment', ${branchId}, '2026-27')`,
      ),
    );
    expect(e.code).toBe("42501");
  });
});

describe("hire_number_series update guard", () => {
  async function seeded() {
    const t = await fx.team();
    const branchId = await branch(t.companyId);
    await sql`insert into hire_number_series (company_id, doc_type, branch_id, fy, prefix, next_no)
              values (${t.companyId}, 'challan', ${branchId}, '2026-27', 'CH/', 5)`;
    const upd = (set: (tx: Sql) => unknown) => as(sql, t.owner, (tx) => set(tx as unknown as Sql) as never);
    return { t, branchId, upd };
  }

  it("lowering next_no fails even for the Owner", async () => {
    const { t, upd } = await seeded();
    const e = await pgError(upd((tx) => tx`update hire_number_series set next_no = 4 where company_id = ${t.companyId}`));
    expect(e.code).toBe("23514");
    expect(e.message).toMatch(/Next number/);
  });

  it("changing branch, financial year or document type fails", async () => {
    const { t, upd } = await seeded();
    const other = await branch(t.companyId);
    for (const [col, val] of [
      ["branch_id", other],
      ["fy", "2027-28"],
      ["doc_type", "truck_payment"],
    ] as const) {
      const e = await pgError(
        upd((tx) => tx.unsafe(`update hire_number_series set ${col} = $1 where company_id = $2`, [val, t.companyId])),
      );
      expect(e.code, col).toBe("23514");
    }
  });

  it("raising next_no and changing prefix / padding work", async () => {
    const { t, upd } = await seeded();
    await upd((tx) => tx`update hire_number_series set next_no = 9, prefix = 'NEW/', padding = 3 where company_id = ${t.companyId}`);
    const [row] = await sql`select prefix, next_no, padding from hire_number_series where company_id = ${t.companyId}`;
    expect([row.prefix, Number(row.next_no), row.padding]).toEqual(["NEW/", 9, 3]);
  });
});

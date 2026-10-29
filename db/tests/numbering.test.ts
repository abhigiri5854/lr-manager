// Document numbers come from number_series under a row lock: gapless, no duplicates.
// The 20-at-once tests are in numbering-concurrent.slow.test.ts (pnpm test:db:slow).
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

const take = (user: string, company: string, kind = "freight_bill", fy = "2026-27") =>
  as(sql, user, async (tx) => {
    const [r] = await tx`select prefix, no from app.allocate_number(${company}, ${kind}, ${fy})`;
    // Hold the lock a moment, as a real save transaction would.
    await tx`select pg_sleep(0.05)`;
    return Number(r.no);
  });

describe("number_series", () => {
  it("a rolled-back save gives its number back (no gap)", async () => {
    const owner = await fx.user();
    const company = await fx.company(owner);
    expect(await take(owner, company)).toBe(1);
    await pgError(
      as(sql, owner, async (tx) => {
        await tx`select * from app.allocate_number(${company}, 'freight_bill', '2026-27')`;
        await tx`select 1 / 0`; // the document save fails
      }),
    );
    expect(await take(owner, company)).toBe(2);
  });

  it("LR numbers run on across FYs; bills restart; prefix is copied per FY", async () => {
    const owner = await fx.user();
    const company = await fx.company(owner);
    await sql`update companies set lr_prefix = 'L-', freight_bill_prefix = 'FB/' where id = ${company}`;
    await as(sql, owner, (tx) => tx`select app.raise_number(${company}, 'lr', '2026-27', 500)`);
    expect(await take(owner, company, "lr", "2026-27")).toBe(500);
    expect(await take(owner, company, "lr", "2027-28")).toBe(501);
    expect(await take(owner, company, "freight_bill", "2027-28")).toBe(1);
    const rows = await sql`select series::text, fy, prefix from number_series
                            where company_id = ${company} and fy = '2027-28' order by series`;
    expect(rows).toEqual([
      { series: "freight_bill", fy: "2027-28", prefix: "FB/" },
      { series: "lr", fy: "2027-28", prefix: "L-" },
    ]);
  });

  it("raise_number never goes backwards", async () => {
    const owner = await fx.user();
    const company = await fx.company(owner);
    await take(owner, company, "lr");
    const e = await pgError(
      as(sql, owner, (tx) => tx`select app.raise_number(${company}, 'lr', '2026-27', 1)`),
    );
    expect(e.message).toMatch(/Can't go below 2/);
  });

  it("an LR series that was never set up is an error", async () => {
    const owner = await fx.user();
    const company = await fx.bareCompany(owner);
    const e = await pgError(take(owner, company, "lr", "2020-21"));
    expect(e.message).toMatch(/Set the next LR number/);
  });
});

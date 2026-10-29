// Document numbers come from number_series under a row lock: gapless, no duplicates.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { as, connect, Fixtures, pgError, type Sql } from "./helpers";

let sql: Sql;
let fx: Fixtures;

beforeAll(() => {
  // 20 connections so the 20 allocations really run at the same time.
  sql = connect(20);
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
  it("20 concurrent allocations get 1..20 exactly once", async () => {
    const owner = await fx.user();
    const company = await fx.company(owner);
    const numbers = await Promise.all(Array.from({ length: 20 }, () => take(owner, company)));
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const [row] = await sql`select next_no from number_series
                             where company_id = ${company} and series = 'freight_bill' and fy = '2026-27'`;
    expect(Number(row.next_no)).toBe(21);
  });

  it("20 concurrent first allocations in a new FY create one row, no duplicates", async () => {
    const owner = await fx.user();
    const company = await fx.company(owner);
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => take(owner, company, "tax_invoice", "2031-32")),
    );
    expect(new Set(numbers).size).toBe(20);
    expect(Math.max(...numbers)).toBe(20); // restarts at 1 each FY (numbering_resets_yearly)
    const rows = await sql`select 1 from number_series
                            where company_id = ${company} and series = 'tax_invoice' and fy = '2031-32'`;
    expect(rows).toHaveLength(1);
  });

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

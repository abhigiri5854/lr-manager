// Slow (pnpm test:db:slow only): 20 allocations at the same time on 20 connections must still be
// gapless and unique. Opens many pooler connections, so it's kept out of pnpm test:db.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { as, connect, Fixtures, type Sql } from "./helpers";

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

describe("number_series under concurrency", () => {
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
});

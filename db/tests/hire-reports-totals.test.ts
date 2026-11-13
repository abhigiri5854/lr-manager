// The dashboard's totals-only reads (get…Totals) must equal the totals of the full report lists, for
// the same filters: they share their SQL pieces, and this keeps them from drifting apart.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { asUser } from "@/lib/data/db/conn";
import * as hr from "@/lib/data/db/hire-reports";
import type { ReportFilters } from "@/lib/validators/hire-report";
import { Fixtures, connect, type Sql } from "./helpers";

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

const uniq = () => crypto.randomUUID().slice(0, 8);

describe("dashboard totals-only reads equal the report totals", () => {
  it("hire outstanding, POD pending and trip margin", async () => {
    const t = await fx.team();
    const co = t.companyId;
    await sql`update companies set min_margin_pct = 10 where id = ${co}`;
    const [b] = await sql`insert into branches (company_id, name) values (${co}, ${`Branch ${uniq()}`}) returning id`;
    const parties: string[] = [];
    for (let i = 0; i < 2; i++) {
      const [p] = await sql`
        insert into truck_parties (company_id, name, pan) values (${co}, ${`Owner ${uniq()}`}, 'ABCPD1234E')
        returning id`;
      parties.push(p.id as string);
    }
    const challan = async (partyId: string, hire: number, status: "draft" | "dispatched") => {
      const [c] = await sql`
        insert into challans (company_id, challan_no, challan_fy, branch_id, payee_party_id, hire_amount, status)
        values (${co}, ${`CH-${uniq()}`}, '2026-27', ${b.id}, ${partyId}, ${hire}, ${status}) returning id`;
      return c.id as string;
    };
    const c1 = await challan(parties[0], 20000, "dispatched");
    await challan(parties[0], 5000, "draft");
    await challan(parties[1], 12000, "dispatched");
    // Part payment on c1 so paid / balance differ from hire.
    const [pay] = await sql`
      insert into truck_payments (company_id, branch_id, payment_no, payment_fy, paid_on, payee_party_id, mode,
                                  amount, tds_amount, status, paid_at)
      values (${co}, ${b.id}, ${`PV-${uniq()}`}, '2026-27', '2026-07-10', ${parties[0]}, 'bank', 9000, 1000, 'paid', now())
      returning id`;
    await sql`
      insert into truck_payment_allocations (company_id, payment_id, challan_id, kind, amount, tds_amount)
      values (${co}, ${pay.id}, ${c1}, 'balance', 9000, 1000)`;

    const page = { page: 1 };
    const all = { page: 1, all: true };
    const filters = { positive: true } as ReportFilters;

    await asUser(t.owner, co, async () => {
      for (const [f, p] of [
        [{ positive: true }, page],
        [{ positive: true }, all],
        [{}, page],
      ] as const) {
        const full = await hr.listHireOutstanding(co, f as ReportFilters, p);
        const only = await hr.getHireOutstandingTotals(co, f as ReportFilters);
        expect(only).toEqual({ total: full.total, totals: full.totals });
      }
      expect((await hr.getHireOutstandingTotals(co, filters)).total).toBe(2);

      const podFull = await hr.listPodPending(co, {} as ReportFilters, page);
      expect(await hr.getPodPendingTotals(co, {} as ReportFilters)).toEqual({ totals: podFull.totals });
      expect(podFull.totals.n).toBe(2);

      const month = { from: "2000-01-01", to: "2100-12-31" } as ReportFilters;
      const marginFull = await hr.listTripMargin(co, month, page);
      expect(await hr.getTripMarginTotals(co, month)).toEqual({ totals: marginFull.totals });
      expect(marginFull.totals.minMarginPct).toBe(10);
      expect(marginFull.totals.costPaise).toBeGreaterThan(0);
    });
  });
});

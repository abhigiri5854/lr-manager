// Hire reports on the database: v_tds_register (0025_hire_reports.sql) — TDS % of a part BALANCE
// payment, a declared party's 0% BALANCE row, gross = amount + TDS, and the quarter of a July date.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
});

const uniq = () => crypto.randomUUID().slice(0, 8);

async function branch(companyId: string) {
  const [b] = await sql`insert into branches (company_id, name) values (${companyId}, ${`Branch ${uniq()}`}) returning id`;
  return b.id as string;
}

async function truckParty(companyId: string) {
  const [p] = await sql`
    insert into truck_parties (company_id, name, pan)
    values (${companyId}, ${`Owner ${uniq()}`}, 'ABCPD1234E') returning id`;
  return p.id as string;
}

async function challan(companyId: string, branchId: string, hire: number) {
  const [c] = await sql`
    insert into challans (company_id, challan_no, challan_fy, branch_id, hire_amount)
    values (${companyId}, ${`CH-${uniq()}`}, '2026-27', ${branchId}, ${hire}) returning id`;
  return c.id as string;
}

/** A paid payment to the party with one allocation (as the system). */
async function paidAllocation(o: {
  companyId: string;
  branchId: string;
  partyId: string;
  challanId: string;
  paidOn: string;
  kind: "advance" | "balance";
  amount: number;
  tds: number;
}) {
  const [p] = await sql`
    insert into truck_payments (company_id, branch_id, payment_no, payment_fy, paid_on, payee_party_id, mode,
                                amount, tds_amount, status, paid_at)
    values (${o.companyId}, ${o.branchId}, ${`PV-${uniq()}`}, '2026-27', ${o.paidOn}, ${o.partyId}, 'bank',
            ${o.amount}, ${o.tds}, 'paid', now())
    returning id`;
  await sql`
    insert into truck_payment_allocations (company_id, payment_id, challan_id, kind, amount, tds_amount)
    values (${o.companyId}, ${p.id}, ${o.challanId}, ${o.kind}, ${o.amount}, ${o.tds})`;
  return p.id as string;
}

const register = async (paymentId: string) =>
  await sql`select tds_percent, gross_amount, net_amount, tds_amount, quarter, fy, has_declaration, allocation_kind
              from v_tds_register where payment_id = ${paymentId}`;

describe("v_tds_register", () => {
  it("shows TDS ÷ (cash paid + TDS) for a part BALANCE payment, gross = amount + TDS, July = Q2", async () => {
    const t = await fx.team();
    const branchId = await branch(t.companyId);
    const partyId = await truckParty(t.companyId);
    const challanId = await challan(t.companyId, branchId, 20000);
    // Part payment: 9,000 cash + 1,000 TDS settles 10,000 of a 20,000 challan.
    const pay = await paidAllocation({
      companyId: t.companyId,
      branchId,
      partyId,
      challanId,
      paidOn: "2026-07-10",
      kind: "balance",
      amount: 9000,
      tds: 1000,
    });

    const rows = await register(pay);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].tds_percent)).toBe(10); // 1000 / 10000, not 1000 / 20000
    expect(Number(rows[0].gross_amount)).toBe(10000);
    expect(Number(rows[0].net_amount)).toBe(9000);
    expect(rows[0].quarter).toBe("Q2");
    expect(rows[0].fy).toBe("2026-27");
  });

  it("lists a declared party's BALANCE payment at 0% TDS, but not an undeclared one", async () => {
    const t = await fx.team();
    const branchId = await branch(t.companyId);
    const declared = await truckParty(t.companyId);
    const undeclared = await truckParty(t.companyId);
    await sql`insert into tds_declarations (company_id, party_id, fy) values (${t.companyId}, ${declared}, '2026-27')`;

    const c1 = await challan(t.companyId, branchId, 15000);
    const c2 = await challan(t.companyId, branchId, 15000);
    const payDeclared = await paidAllocation({
      companyId: t.companyId,
      branchId,
      partyId: declared,
      challanId: c1,
      paidOn: "2026-07-20",
      kind: "balance",
      amount: 15000,
      tds: 0,
    });
    const payUndeclared = await paidAllocation({
      companyId: t.companyId,
      branchId,
      partyId: undeclared,
      challanId: c2,
      paidOn: "2026-07-20",
      kind: "balance",
      amount: 15000,
      tds: 0,
    });

    const rows = await register(payDeclared);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].tds_percent)).toBe(0);
    expect(Number(rows[0].gross_amount)).toBe(15000);
    expect(rows[0].has_declaration).toBe(true);
    expect(rows[0].allocation_kind).toBe("balance");
    expect(await register(payUndeclared)).toHaveLength(0);
  });
});

// Unique constraints and DB backstops from docs/DATABASE.md §3 / §11.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { as, connect, fakeGstin, Fixtures, pgError, type Sql } from "./helpers";

let sql: Sql;
let fx: Fixtures;

beforeAll(() => {
  sql = connect();
  fx = new Fixtures(sql);
});
afterEach(() => fx.cleanup());
afterAll(() => sql.end());

const UNIQUE = "23505";

async function company() {
  const owner = await fx.user();
  return { owner, id: await fx.company(owner) };
}

describe("unique per company", () => {
  it("party GSTIN: unique among live parties; free again once cancelled; other companies unaffected", async () => {
    const a = await company();
    const b = await company();
    const gstin = fakeGstin();
    const first = await fx.party(a.id, "First", gstin);
    expect((await pgError(fx.party(a.id, "Dup", gstin))).code).toBe(UNIQUE);
    await fx.party(b.id, "Same GSTIN, other company", gstin);
    await as(sql, a.owner, (tx) => tx`update parties set cancelled_at = now() where id = ${first}`);
    await fx.party(a.id, "Re-added", gstin);
  });

  it("party GSTIN must have the GSTIN shape", async () => {
    const a = await company();
    expect((await pgError(fx.party(a.id, "Bad", "NOT-A-GSTIN"))).code).toBe("23514");
  });

  it("one self party per company", async () => {
    const a = await company();
    const e = await pgError(
      sql`insert into parties (company_id, name, is_self) values (${a.id}, 'Second self', true)`,
    );
    expect(e.code).toBe(UNIQUE);
  });

  it("truck number: unique among live trucks, normalised (no spaces / lower case)", async () => {
    const a = await company();
    const t = await fx.truck(a.id, "BR01GN8331");
    expect((await pgError(fx.truck(a.id, "BR01GN8331"))).code).toBe(UNIQUE);
    expect((await pgError(fx.truck(a.id, "br01 gn 8331"))).code).toBe("23514");
    await as(sql, a.owner, (tx) => tx`update trucks set cancelled_at = now() where id = ${t}`);
    await fx.truck(a.id, "BR01GN8331");
  });

  it("driver mobile: unique among live drivers", async () => {
    const a = await company();
    await fx.driver(a.id, "9000000009");
    expect((await pgError(fx.driver(a.id, "9000000009"))).code).toBe(UNIQUE);
  });

  it("item code: unique per company, case-insensitive", async () => {
    const a = await company();
    await sql`insert into items (company_id, code, name) values (${a.id}, 'ABC1', 'Tank')`;
    const e = await pgError(sql`insert into items (company_id, code, name) values (${a.id}, 'abc1', 'Tank 2')`);
    expect(e.code).toBe(UNIQUE);
  });

  it("LR number: unique including cancelled LRs", async () => {
    const a = await company();
    const lr = await fx.bookedLr(a.id, { lrNo: "19019" });
    await as(sql, a.owner, (tx) => tx`update lrs set cancelled_at = now() where id = ${lr}`);
    expect((await pgError(fx.bookedLr(a.id, { lrNo: "19019" }))).code).toBe(UNIQUE);
  });

  it("freight bill number (FY + seq): unique including cancelled bills", async () => {
    const a = await company();
    const party = await fx.party(a.id);
    const insert = () => sql`
      insert into freight_bills (company_id, party_id, bill_date, gst_mode, bill_fy, bill_seq)
      values (${a.id}, ${party}, '2026-10-27', 'reverse_charge', '2026-27', 7) returning id`;
    const [b] = await insert();
    await sql`update freight_bills set cancelled_at = now() where id = ${b.id}`;
    expect((await pgError(insert())).code).toBe(UNIQUE);
  });

  it("tax invoice number: unique per seller + FY (two sellers may share a number)", async () => {
    const a = await company();
    const buyer = await fx.party(a.id);
    const sellerA = await fx.party(a.id);
    const sellerB = await fx.party(a.id);
    const insert = (seller: string | null) => sql`
      insert into tax_invoices (company_id, invoice_no, invoice_fy, invoice_at, seller_party_id, bill_to_id,
                                place_of_supply_state_code)
      values (${a.id}, 'INV-1', '2026-27', now(), ${seller}, ${buyer}, '10')`;
    await insert(sellerA);
    await insert(sellerB);
    await insert(null); // own series
    expect((await pgError(insert(sellerA))).code).toBe(UNIQUE);
    expect((await pgError(insert(null))).code).toBe(UNIQUE);
  });

  it("one live POD per LR", async () => {
    const a = await company();
    const lr = await fx.bookedLr(a.id);
    await sql`insert into pods (company_id, lr_id) values (${a.id}, ${lr})`;
    expect((await pgError(sql`insert into pods (company_id, lr_id) values (${a.id}, ${lr})`)).code).toBe(UNIQUE);
  });

  it("an LR is on at most one live freight bill; free again once that bill is cancelled", async () => {
    const a = await company();
    const party = await fx.party(a.id);
    const lr = await fx.bookedLr(a.id);
    const bill = await fx.finalBill(a.id, party, [lr], 1000);
    expect((await pgError(fx.finalBill(a.id, party, [lr], 1000))).code).toBe(UNIQUE);
    await as(sql, a.owner, (tx) => tx`update freight_bills set cancelled_at = now() where id = ${bill}`);
    await fx.finalBill(a.id, party, [lr], 1000);
  });

  it("a payment can only settle bills of its own party", async () => {
    const a = await company();
    const p1 = await fx.party(a.id);
    const p2 = await fx.party(a.id);
    const bill = await fx.finalBill(a.id, p1, [await fx.bookedLr(a.id)], 1000);
    const [pay] = await sql`insert into payments (company_id, party_id, amount_paise, mode, received_on)
                            values (${a.id}, ${p2}, 1000, 'cash', '2026-11-01') returning id`;
    const e = await pgError(sql`insert into payment_allocations (company_id, payment_id, freight_bill_id, amount_paise)
                                values (${a.id}, ${pay.id}, ${bill}, 1000)`);
    expect(e.message).toMatch(/another party/);
  });

  it("a booked LR needs its date and snapshot", async () => {
    const a = await company();
    const e = await pgError(
      sql`insert into lrs (company_id, lr_no, booked_at) values (${a.id}, 'X1', now())`,
    );
    expect(e.code).toBe("23514");
  });

  it("a finalised bill's snapshot can't change", async () => {
    const a = await company();
    const party = await fx.party(a.id);
    const bill = await fx.finalBill(a.id, party, [await fx.bookedLr(a.id)], 1000);
    const e = await pgError(
      sql`update freight_bills set snapshot = '{"company":{"name":"X"},"party":{}}'::jsonb where id = ${bill}`,
    );
    expect(e.message).toMatch(/snapshot/);
  });

  it("updates bump version and stamp updated_by; optimistic lock sees the change", async () => {
    const a = await company();
    const party = await fx.party(a.id);
    const r1 = await as(sql, a.owner, (tx) => tx`update parties set place = 'Patna' where id = ${party} and version = 1`);
    expect(r1.count).toBe(1);
    const stale = await as(sql, a.owner, (tx) => tx`update parties set place = 'Gaya' where id = ${party} and version = 1`);
    expect(stale.count).toBe(0); // → ConflictError in lib/data
    const [p] = await sql`select version, updated_by from parties where id = ${party}`;
    expect(p).toEqual({ version: 2, updated_by: a.owner });
  });
});

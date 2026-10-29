// For every LR, the stored pod_received_at / billed_at / paid_at must equal what lib/lr-status
// derives from the linked POD, bill and payments — after every kind of write.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { deriveLrStatus, lrStampsFrom } from "@/lib/lr-status";
import type { LrStatus } from "@/lib/types";
import { as, connect, Fixtures, type Sql } from "./helpers";

let sql: Sql;
let fx: Fixtures;

beforeAll(() => {
  sql = connect();
  fx = new Fixtures(sql);
});
afterEach(() => fx.cleanup());
afterAll(() => sql.end());

/** Checks every LR of the company; returns each LR's status by id. */
async function expectConsistent(companyId: string): Promise<Record<string, LrStatus>> {
  const lrs = await sql`
    select id, lr_no, cancelled_at::text, booked_at::text, dispatched_at::text, delivered_at::text,
           pod_received_at::text, billed_at::text, paid_at::text
      from lrs where company_id = ${companyId}`;
  const status: Record<string, LrStatus> = {};
  for (const lr of lrs) {
    const [pod] = await sql`select received_at::text from pods
                             where company_id = ${companyId} and lr_id = ${lr.id} and cancelled_at is null`;
    const [bill] = await sql`
      select b.id, b.bill_date::text, b.amount_paise
        from freight_bill_lines fl
        join freight_bills b on b.id = fl.freight_bill_id
       where fl.company_id = ${companyId} and fl.lr_id = ${lr.id}
         and b.cancelled_at is null and b.status = 'final'`;
    const allocations = bill
      ? await sql`select a.amount_paise, p.received_on::text
                    from payment_allocations a join payments p on p.id = a.payment_id
                   where a.freight_bill_id = ${bill.id} and p.cancelled_at is null`
      : [];
    const derived = lrStampsFrom({
      pod: pod ? { receivedAt: pod.received_at } : null,
      finalBill: bill ? { billDate: bill.bill_date, amountPaise: Number(bill.amount_paise) } : null,
      allocations: allocations.map((a) => ({
        amountPaise: Number(a.amount_paise),
        receivedOn: a.received_on,
      })),
    });
    const stored = { podReceivedAt: lr.pod_received_at, billedAt: lr.billed_at, paidAt: lr.paid_at };
    expect(stored, `LR ${lr.lr_no}`).toEqual(derived);
    status[lr.id] = deriveLrStatus({
      cancelledAt: lr.cancelled_at ?? undefined,
      bookedAt: lr.booked_at,
      dispatchedAt: lr.dispatched_at,
      deliveredAt: lr.delivered_at,
      ...stored,
    });
  }
  return status;
}

describe("cached LR stamps in the database", () => {
  it("follow every POD, bill and payment write", async () => {
    const t = await fx.team();
    const co = t.companyId;
    const party = await fx.party(co);
    const a = await fx.bookedLr(co, { lrNo: "A" });
    const b = await fx.bookedLr(co, { lrNo: "B" });
    const run = <T>(fn: Parameters<typeof as<T>>[2]) => as(sql, t.owner, fn);

    // POD: delivered, signed copy arrives, cancelled, recorded again.
    const [pod] = await run(async (tx) => {
      await tx`select app.set_lr_delivered(${co}, ${a}, '2026-10-16')`;
      return tx`insert into pods (company_id, lr_id) values (${co}, ${a}) returning id`;
    });
    expect((await expectConsistent(co))[a]).toBe("Delivered");
    const versionsAfterDelivery = await sql`select id, version from lrs where company_id = ${co} order by id`;
    await run((tx) => tx`update pods set received_at = '2026-10-20T10:00:00Z' where id = ${pod.id}`);
    expect((await expectConsistent(co))[a]).toBe("POD received");
    await run((tx) => tx`update pods set cancelled_at = now() where id = ${pod.id}`);
    expect((await expectConsistent(co))[a]).toBe("Delivered");
    await run((tx) => tx`insert into pods (company_id, lr_id, received_at) values (${co}, ${a}, '2026-10-21T09:00:00Z')`);
    await expectConsistent(co);

    // Bill: draft (no stamp), a line added and removed, finalised, cancelled.
    const [draft] = await run((tx) => tx`
      insert into freight_bills (company_id, party_id, bill_date, gst_mode, amount_paise, charges_paise)
      values (${co}, ${party}, '2026-10-27', 'reverse_charge', 350000, 350000) returning id`);
    await run(async (tx) => {
      await tx`insert into freight_bill_lines (company_id, freight_bill_id, lr_id, position, freight_paise, total_paise)
               values (${co}, ${draft.id}, ${a}, 0, 250000, 250000), (${co}, ${draft.id}, ${b}, 1, 100000, 100000)`;
    });
    expect((await expectConsistent(co))[a]).toBe("POD received");
    await run((tx) => tx`delete from freight_bill_lines where freight_bill_id = ${draft.id} and lr_id = ${b}`);
    await run((tx) => tx`insert into freight_bill_lines (company_id, freight_bill_id, lr_id, position, freight_paise, total_paise)
                         values (${co}, ${draft.id}, ${b}, 1, 100000, 100000)`);
    await expectConsistent(co);
    await run((tx) => tx`update freight_bills set status = 'final', bill_no = 'FB/001', bill_fy = '2026-27', bill_seq = 1,
                         snapshot = '{"company":{},"party":{}}'::jsonb where id = ${draft.id}`);
    let s = await expectConsistent(co);
    expect([s[a], s[b]]).toEqual(["Billed", "Billed"]);
    await run((tx) => tx`update freight_bills set cancelled_at = now() where id = ${draft.id}`);
    s = await expectConsistent(co);
    expect([s[a], s[b]]).toEqual(["POD received", "Booked"]);

    // New final bill, then payments: partial, full, edited down, cancelled; bill date moved.
    const bill = await fx.finalBill(co, party, [a, b], 350000, "2026-10-28");
    await expectConsistent(co);
    const pay = async (amount: number, on: string) => {
      const [p] = await as(sql, t.accountant, async (tx) => {
        const [row] = await tx`insert into payments (company_id, party_id, amount_paise, mode, received_on)
                               values (${co}, ${party}, ${amount}, 'neft_upi', ${on}) returning id`;
        await tx`insert into payment_allocations (company_id, payment_id, freight_bill_id, amount_paise)
                 values (${co}, ${row.id}, ${bill}, ${amount})`;
        return [row];
      });
      return p.id as string;
    };
    const p1 = await pay(150000, "2026-11-01");
    expect((await expectConsistent(co))[a]).toBe("Billed");
    const p2 = await pay(200000, "2026-11-05");
    s = await expectConsistent(co);
    expect([s[a], s[b]]).toEqual(["Paid", "Paid"]);
    await as(sql, t.accountant, (tx) =>
      tx`update payment_allocations set amount_paise = 100000 where payment_id = ${p2}`);
    expect((await expectConsistent(co))[b]).toBe("Billed");
    await as(sql, t.accountant, async (tx) => {
      await tx`update payment_allocations set amount_paise = 200000 where payment_id = ${p2}`;
      await tx`update payments set received_on = '2026-11-07' where id = ${p2}`;
    });
    expect((await expectConsistent(co))[a]).toBe("Paid");
    await run((tx) => tx`update payments set cancelled_at = now() where id = ${p1}`);
    expect((await expectConsistent(co))[a]).toBe("Billed");
    await run((tx) => tx`update freight_bills set bill_date = '2026-10-29' where id = ${bill}`);
    await expectConsistent(co);

    // Stamp changes are caches: the LR version (optimistic lock for edits) didn't move after the
    // delivery date (a real LR change) was recorded.
    const versions = await sql`select id, version from lrs where company_id = ${co} order by id`;
    expect(versions).toEqual(versionsAfterDelivery);
  });

  it("users can't write the stamps directly", async () => {
    const t = await fx.team();
    const lr = await fx.bookedLr(t.companyId);
    await as(sql, t.owner, (tx) => tx`update lrs set paid_at = '2026-01-01', remarks = 'x' where id = ${lr}`);
    const [row] = await sql`select paid_at, remarks from lrs where id = ${lr}`;
    expect(row).toEqual({ paid_at: null, remarks: "x" });
  });

  it("the seeded sample data is consistent", async () => {
    for (const c of await sql`select id from companies where id in
        ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102')`) {
      await expectConsistent(c.id as string);
    }
  });
});

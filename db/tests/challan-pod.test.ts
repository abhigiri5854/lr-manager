// POD settlement on the database (T1-07): settling with no truck payments, the settled lock, the
// LR POD → challan sync (office user and driver) and the charge type's bill column. Real lib/data
// functions, signed in through the session cookie (same set-up as lib-data-billing.test.ts).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Fixtures, connect, type Sql } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

process.env.DATA_SOURCE = "db";

const session = await import("@/lib/data/session");
const pods = await import("@/lib/data/pod");
const bills = await import("@/lib/data/bills");
const cp = await import("@/lib/data/db/challan-pod");

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

function signIn(userId: string, companyId?: string) {
  jar.clear();
  jar.set(session.SESSION_COOKIE, session.sessionCookieValue(userId));
  if (companyId) jar.set("lrm_company", companyId);
}

const india = (date: string) => new Date(`${date}T00:00:00+05:30`).toISOString();

/** A dispatched challan (as the system) carrying these LRs, 10 packages each. */
async function dispatchedChallan(companyId: string, lrIds: string[], no = `CH-${crypto.randomUUID().slice(0, 6)}`) {
  const [b] = await sql`insert into branches (company_id, name) values (${companyId}, ${`Branch ${no}`}) returning id`;
  const [c] = await sql`
    insert into challans (company_id, challan_no, challan_fy, branch_id, hire_amount)
    values (${companyId}, ${no}, '2026-27', ${b.id}, 20000) returning id`;
  for (const lrId of lrIds)
    await sql`insert into challan_lrs (company_id, challan_id, lr_id, loaded_pkgs, freight_allocated)
              values (${companyId}, ${c.id}, ${lrId}, 10, 10000)`;
  await sql`update challans set status = 'dispatched', dispatched_at = ${india("2026-10-15")}
             where id = ${c.id}`;
  return { id: c.id as string, no };
}

const challanRow = async (id: string) =>
  (await sql`select status, version, unloaded_at, pod_received_at from challans where id = ${id}`)[0];
const deliveredOf = async (challanId: string, lrId: string) =>
  (await sql`select delivered_pkgs from challan_lrs where challan_id = ${challanId} and lr_id = ${lrId}`)[0]
    .delivered_pkgs as number | null;

describe("settling a challan", () => {
  it("settles with zero truck payments, then the settled challan refuses POD changes", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const lr = await fx.bookedLr(t.companyId);
    const ch = await dispatchedChallan(t.companyId, [lr]);

    const v1 = (await challanRow(ch.id)).version as number;
    const rec = await cp.recordChallanPod(
      t.companyId,
      ch.id,
      v1,
      { unloadedAt: india("2026-10-18"), podReceivedAt: india("2026-10-20"), lrs: [{ lrId: lr, deliveredPkgs: 10 }] },
      "owner",
    );
    expect(rec.status).toBe("pod_received");
    expect(rec.money.paid).toBe("0.00");
    const [{ n }] = await sql`select count(*)::int as n from truck_payments where company_id = ${t.companyId}`;
    expect(n).toBe(0);

    const settled = await cp.settleChallan(t.companyId, ch.id, rec.version);
    expect(settled.status).toBe("settled");

    // The LR POD screen (office) and the challan screen both refuse.
    const pod = (await pods.getPodByLrId(t.companyId, lr))!;
    await expect(
      pods.updatePod(t.companyId, pod.id, pod.version, { packagesReceived: 9 }),
    ).rejects.toThrow(`Challan ${ch.no} is settled; reopen it to change POD`);
    expect((await pods.getPodByLrId(t.companyId, lr))!.packagesReceived).toBe(10); // rolled back
    await expect(
      cp.recordChallanPod(t.companyId, ch.id, settled.version, { podReceivedAt: india("2026-10-21"), lrs: [] }, "owner"),
    ).rejects.toThrow(/settled/);

    // Reopened → the LR POD edit goes through and reaches the challan.
    const reopened = await cp.reopenChallan(t.companyId, ch.id, settled.version, "Short count found");
    expect(reopened.status).toBe("pod_received");
    await pods.updatePod(t.companyId, pod.id, pod.version, { packagesReceived: 9 });
    expect(await deliveredOf(ch.id, lr)).toBe(9);
  });

  it("a driver records the POD late → settling applies the late-POD fee", async () => {
    const t = await fx.team();
    await sql`update companies set late_pod_days = 3, late_pod_fee = 500 where id = ${t.companyId}`;
    await fx.driver(t.companyId, "9876543211", t.driver);
    const lr = await fx.bookedLr(t.companyId, { driverMobile: "9876543211" });
    const ch = await dispatchedChallan(t.companyId, [lr]);

    // Unloaded 10 Oct, POD received 20 Oct: 10 days > 3 allowed. The driver's sync writes dates only.
    signIn(t.driver, t.companyId);
    await pods.createPod(t.companyId, {
      lrId: lr,
      deliveredOn: "2026-10-10",
      packagesReceived: 10,
      receivedAt: "2026-10-20T06:00:00.000Z",
    });
    const c = await challanRow(ch.id);
    expect(c.status).toBe("pod_received");

    signIn(t.owner, t.companyId);
    const settled = await cp.settleChallan(t.companyId, ch.id, c.version as number);
    expect(settled.status).toBe("settled");
    const late = await sql`
      select amount, auto_amount, override_reason from challan_charges
       where challan_id = ${ch.id} and auto_kind = 'late_pod' and cancelled_at is null`;
    expect(late).toHaveLength(1);
    expect(String(late[0].amount)).toBe("500.00");
    expect(String(late[0].auto_amount)).toBe("500.00");
    const s = (await cp.getChallanSettlement(t.companyId, ch.id))!;
    expect(s.charges.find((g) => g.autoKind === "late_pod")?.amount).toBe("500.00");
  });

  it("settling recomputes the late-POD fee but keeps a manual override's amount", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const lr = await fx.bookedLr(t.companyId);
    const ch = await dispatchedChallan(t.companyId, [lr]);
    const rec = await cp.recordChallanPod(
      t.companyId,
      ch.id,
      (await challanRow(ch.id)).version as number,
      { unloadedAt: india("2026-10-10"), podReceivedAt: india("2026-10-20"), lrs: [{ lrId: lr, deliveredPkgs: 10 }] },
      "owner",
    );
    expect(rec.charges.find((g) => g.autoKind === "late_pod")).toBeUndefined(); // no rule yet
    const ov = await cp.saveChallanPodCharges(t.companyId, ch.id, rec.version, {
      charges: [],
      remove: [],
      latePodOverride: { amount: "200", reason: "Agreed with owner" },
    });
    // The rule is switched on after the POD was recorded: settle picks it up for auto_amount only.
    await sql`update companies set late_pod_days = 3, late_pod_fee = 500 where id = ${t.companyId}`;
    await cp.settleChallan(t.companyId, ch.id, ov.version);
    const [late] = await sql`
      select amount, auto_amount, override_reason from challan_charges
       where challan_id = ${ch.id} and auto_kind = 'late_pod' and cancelled_at is null`;
    expect(String(late.auto_amount)).toBe("500.00");
    expect(String(late.amount)).toBe("200.00");
    expect(late.override_reason).toBe("Agreed with owner");
  });
});

describe("LR POD → challan sync", () => {
  it("office POD save sets the challan's unloading / POD dates, status and delivered packages", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const lr = await fx.bookedLr(t.companyId);
    const ch = await dispatchedChallan(t.companyId, [lr]);

    const pod = await pods.createPod(t.companyId, {
      lrId: lr,
      deliveredOn: "2026-10-18",
      packagesReceived: 8,
      condition: "short",
      remarks: "2 bags short",
    });
    let c = await challanRow(ch.id);
    expect(new Date(c.unloaded_at).toISOString()).toBe(india("2026-10-18"));
    expect(c.pod_received_at).toBeNull();
    expect(c.status).toBe("dispatched");
    expect(await deliveredOf(ch.id, lr)).toBe(8);

    const receivedAt = "2026-10-21T06:00:00.000Z";
    await pods.updatePod(t.companyId, pod.id, pod.version, { receivedAt });
    c = await challanRow(ch.id);
    expect(new Date(c.pod_received_at).toISOString()).toBe(receivedAt);
    expect(c.status).toBe("pod_received");
    expect(new Date(c.unloaded_at).toISOString()).toBe(india("2026-10-18")); // unchanged

    const audit = await sql`select action from audit_log where record_id = ${ch.id}`;
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it("more packages than the challan loaded is refused and nothing is saved", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const lr = await fx.bookedLr(t.companyId);
    await dispatchedChallan(t.companyId, [lr]);
    await expect(
      pods.createPod(t.companyId, { lrId: lr, deliveredOn: "2026-10-18", packagesReceived: 11 }),
    ).rejects.toThrow(/loaded 10 packages/);
    expect(await pods.getPodByLrId(t.companyId, lr)).toBeNull();
  });

  it("a driver's POD on their own trip reaches the challan; a settled challan refuses the driver too", async () => {
    const t = await fx.team();
    await fx.driver(t.companyId, "9876543210", t.driver);
    const lr = await fx.bookedLr(t.companyId, { driverMobile: "9876543210" });
    const ch = await dispatchedChallan(t.companyId, [lr]);

    signIn(t.driver, t.companyId);
    const pod = await pods.createPod(t.companyId, {
      lrId: lr,
      deliveredOn: "2026-10-19",
      packagesReceived: 10,
      receivedAt: "2026-10-20T06:00:00.000Z",
    });
    const c = await challanRow(ch.id);
    expect(new Date(c.unloaded_at).toISOString()).toBe(india("2026-10-19"));
    expect(c.status).toBe("pod_received");
    expect(await deliveredOf(ch.id, lr)).toBe(10);
    const [a] = await sql`select user_id from audit_log where record_id = ${ch.id} order by created_at desc limit 1`;
    expect(a.user_id).toBe(t.driver);

    signIn(t.owner, t.companyId);
    await cp.settleChallan(t.companyId, ch.id, c.version as number);
    signIn(t.driver, t.companyId);
    await expect(
      pods.updatePod(t.companyId, pod.id, pod.version, { packagesReceived: 9 }),
    ).rejects.toThrow(`Challan ${ch.no} is settled; reopen it to change POD`);
  });

  it("an LR on no challan saves its POD as before", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const lr = await fx.bookedLr(t.companyId);
    const pod = await pods.createPod(t.companyId, { lrId: lr, deliveredOn: "2026-10-18" });
    expect(pod.lrId).toBe(lr);
  });
});

/** A party-billable POD charge (party amount 500) on a dispatched challan; the LR's consignee pays. */
async function billableCharge(companyId: string) {
  const party = await fx.party(companyId);
  const lr = await fx.bookedLr(companyId);
  await sql`update lrs set consignee_id = ${party} where id = ${lr}`;
  const ch = await dispatchedChallan(companyId, [lr]);
  const [ty] = await sql`
    insert into charge_types (company_id, code, label, default_direction, stage, active, bill_column)
    values (${companyId}, ${`DET${crypto.randomUUID().slice(0, 4)}`}, 'Detention', 'add', 'pod', true, 'detention')
    returning id`;
  const s = await cp.saveChallanPodCharges(companyId, ch.id, (await challanRow(ch.id)).version as number, {
    charges: [{ chargeTypeId: ty.id as string, lrId: lr, amount: "0", partyAmount: "500" }],
    remove: [],
  });
  return { party, lr, chargeId: s.charges[0].id };
}

const billFor = (partyId: string, lrId: string) => ({
  billDate: "2026-10-27",
  partyId,
  gstMode: "reverse_charge" as const,
  lines: [{ lrId, freightPaise: 5000_00 }],
});

const billedIn = async (chargeId: string) =>
  (await sql`select billed_in_freight_bill_id as b from challan_charges where id = ${chargeId}`)[0].b as string | null;

describe("party-billable POD charges on freight bills", () => {
  it("a charge can't be billed twice; cancelling its bill makes it billable again", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const { party, lr, chargeId } = await billableCharge(t.companyId);
    expect((await bills.listUnbilledChallanCharges(t.companyId, party)).map((u) => u.chargeId)).toEqual([chargeId]);

    const first = await bills.createFreightBill(t.companyId, billFor(party, lr), { chargeIds: [chargeId] });
    expect(first.totals.amountPaise).toBe(5500_00);
    expect(await billedIn(chargeId)).toBe(first.id);
    expect(await bills.listUnbilledChallanCharges(t.companyId, party)).toEqual([]);

    // (a) Second bill with the same charge fails, and nothing of it is saved.
    await expect(
      bills.createFreightBill(t.companyId, billFor(party, lr), { chargeIds: [chargeId] }),
    ).rejects.toThrow(/already on (freight )?bill/i);
    const [{ n }] = await sql`select count(*)::int as n from freight_bills where company_id = ${t.companyId}`;
    expect(n).toBe(1);
    expect(await billedIn(chargeId)).toBe(first.id);
    // The database refuses the move on its own too (b3_charge_guard), whatever the app checks.
    const lr2 = await fx.bookedLr(t.companyId);
    const other = await bills.createFreightBill(t.companyId, billFor(party, lr2));
    await expect(
      sql`update challan_charges set billed_in_freight_bill_id = ${other.id} where id = ${chargeId}`,
    ).rejects.toThrow(/already on a freight bill/);

    // (b) Cancelling the bill frees the charge: listed again and billable on a new bill.
    await bills.cancelFreightBill(t.companyId, first.id, "Wrong rate");
    expect((await bills.listUnbilledChallanCharges(t.companyId, party)).map((u) => u.chargeId)).toEqual([chargeId]);
    const again = await bills.createFreightBill(t.companyId, billFor(party, lr), { chargeIds: [chargeId] });
    expect(again.totals.amountPaise).toBe(5500_00);
    expect(await billedIn(chargeId)).toBe(again.id);
  });

  it("(c) a company B user can't list or bill company A's unbilled charges", async () => {
    const a = await fx.team();
    signIn(a.owner, a.companyId);
    const { chargeId } = await billableCharge(a.companyId);

    const b = await fx.team();
    signIn(b.owner, b.companyId);
    const bParty = await fx.party(b.companyId);
    const bLr = await fx.bookedLr(b.companyId);
    await sql`update lrs set consignee_id = ${bParty} where id = ${bLr}`;

    // Listing: B's own company doesn't show it; asking for A's company shows nothing / is refused.
    expect((await bills.listUnbilledChallanCharges(b.companyId)).map((u) => u.chargeId)).not.toContain(chargeId);
    const listA = await bills.listUnbilledChallanCharges(a.companyId).catch(() => [] as { chargeId: string }[]);
    expect(listA.map((u) => u.chargeId)).not.toContain(chargeId);

    // Billing: on B's bill the charge isn't found; on A's company B is refused.
    await expect(
      bills.createFreightBill(b.companyId, billFor(bParty, bLr), { chargeIds: [chargeId] }),
    ).rejects.toThrow(/Charge not found in this company/);
    await expect(
      bills.createFreightBill(a.companyId, billFor(bParty, bLr), { chargeIds: [chargeId] }),
    ).rejects.toThrow();
    expect(await billedIn(chargeId)).toBeNull();
    const [{ n }] = await sql`select count(*)::int as n from freight_bills where company_id in (${a.companyId}, ${b.companyId})`;
    expect(n).toBe(0);
  });
});

describe("charge type bill column", () => {
  it("bill_column decides the freight-bill column, not the code / label", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const consignee = await fx.party(t.companyId);
    const lr = await fx.bookedLr(t.companyId);
    await sql`update lrs set consignee_id = ${consignee} where id = ${lr}`;
    const ch = await dispatchedChallan(t.companyId, [lr]);
    const types = await sql`
      insert into charge_types (company_id, code, label, default_direction, stage, active, bill_column)
      values (${t.companyId}, 'WAIT', 'Halting', 'add', 'pod', true, 'detention'),
             (${t.companyId}, 'DETENTION_X', 'Detention (unloading)', 'add', 'pod', true, 'unloading')
      returning id, code`;
    const [{ bill_column: dflt }] = await sql`
      insert into charge_types (company_id, code, label, default_direction, stage, active)
      values (${t.companyId}, 'MISC', 'Misc', 'add', 'pod', true) returning bill_column`;
    expect(dflt).toBe("other");

    const c = await challanRow(ch.id);
    await cp.saveChallanPodCharges(t.companyId, ch.id, c.version as number, {
      charges: types.map((ty) => ({ chargeTypeId: ty.id as string, lrId: lr, amount: "0", partyAmount: "500" })),
      remove: [],
    });
    const unbilled = await cp.listUnbilledChallanCharges(t.companyId, consignee);
    const byLabel = Object.fromEntries(unbilled.map((u) => [u.label, u.column]));
    expect(byLabel).toEqual({ Halting: "detention", "Detention (unloading)": "other" });
  });
});

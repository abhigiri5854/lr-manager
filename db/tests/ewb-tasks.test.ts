// E-way checklist on the database (T1-11): vehicle change → Part-B tasks, settled lock, Mark done,
// company isolation, and the LR-invoice fallback / computed expiry. Real lib/data functions, signed in
// through the session cookie (same set-up as challan-pod.test.ts).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Fixtures, as, connect, type Sql } from "./helpers";

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
const challans = await import("@/lib/data/challans");
const ewbDb = await import("@/lib/data/db/ewb");
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

const EWB_A = "111111111111";
const EWB_B = "222222222222";

async function vehicle(companyId: string, no: string, ownerId: string | null = null) {
  const [v] = await sql`
    insert into market_vehicles (company_id, vehicle_no, owner_party_id) values (${companyId}, ${no}, ${ownerId})
    returning id`;
  return v.id as string;
}

async function owner(companyId: string, name: string) {
  const [p] = await sql`insert into truck_parties (company_id, name, role) values (${companyId}, ${name}, 'owner') returning id`;
  return p.id as string;
}

/**
 * A dispatched challan on `vehicleId` with three LRs: A has its own e-way line data (date + distance),
 * B has an e-way bill only on its LR invoice (fallback, entered expiry), C has none.
 */
async function challanWithEwb(companyId: string, vehicleId: string, payeeId: string | null = null) {
  const no = `CH-${crypto.randomUUID().slice(0, 6)}`;
  const [b] = await sql`insert into branches (company_id, name) values (${companyId}, ${`Branch ${no}`}) returning id`;
  const [c] = await sql`
    insert into challans (company_id, challan_no, challan_fy, branch_id, hire_amount, vehicle_id, payee_party_id)
    values (${companyId}, ${no}, '2026-27', ${b.id}, 20000, ${vehicleId}, ${payeeId}) returning id`;
  const lrA = await fx.bookedLr(companyId);
  const lrB = await fx.bookedLr(companyId);
  const lrC = await fx.bookedLr(companyId);
  await sql`insert into challan_lrs (company_id, challan_id, lr_id, loaded_pkgs, freight_allocated, ewb_no, ewb_date, ewb_distance_km)
            values (${companyId}, ${c.id}, ${lrA}, 10, 5000, ${EWB_A}, '2026-11-10', 150)`;
  await sql`insert into challan_lrs (company_id, challan_id, lr_id, loaded_pkgs, freight_allocated)
            values (${companyId}, ${c.id}, ${lrB}, 10, 5000), (${companyId}, ${c.id}, ${lrC}, 10, 5000)`;
  await sql`insert into lr_invoices (company_id, lr_id, position, invoice_no, eway_bill_no, eway_expires_at)
            values (${companyId}, ${lrB}, 0, 'INV-B', ${EWB_B}, '2026-11-20T18:30:00.000Z')`;
  await sql`update challans set status = 'dispatched', dispatched_at = now() where id = ${c.id}`;
  const [{ version }] = await sql`select version from challans where id = ${c.id}`;
  return { id: c.id as string, version: version as number, lrA, lrB, lrC };
}

/** Settle a challan the real way: record the POD, then settle (a trigger blocks a direct status update). */
async function settleViaPod(companyId: string, ch: { id: string; lrA: string; lrB: string; lrC: string }) {
  const [{ version }] = await sql`select version from challans where id = ${ch.id}`;
  const now = new Date().toISOString();
  const rec = await cp.recordChallanPod(
    companyId,
    ch.id,
    version as number,
    {
      unloadedAt: now,
      podReceivedAt: now,
      lrs: [ch.lrA, ch.lrB, ch.lrC].map((lrId) => ({ lrId, deliveredPkgs: 10 })),
    },
    "owner",
  );
  const settled = await cp.settleChallan(companyId, ch.id, rec.version);
  return settled.version as number;
}

describe("vehicle change creates Part-B tasks", () => {
  it("one task per LR with an e-way no. (own line or LR invoice), none for the rest", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const v1 = await vehicle(t.companyId, "BR01AA1111");
    const v2 = await vehicle(t.companyId, "BR01BB2222");
    const ch = await challanWithEwb(t.companyId, v1);

    const r = await challans.changeChallanVehicle(t.companyId, ch.id, ch.version, {
      newVehicleId: v2,
      reason: "Breakdown at Aurangabad",
    });
    expect(r.tasks).toBe(2);
    expect(r.vehicleNo).toBe("BR01BB2222");

    const tasks = await sql`select lr_id, ewb_no, old_vehicle_id, new_vehicle_id, note, done_at
                              from ewb_tasks where challan_id = ${ch.id} order by ewb_no`;
    expect(tasks.map((x) => x.ewb_no)).toEqual([EWB_A, EWB_B]);
    expect(tasks.map((x) => x.lr_id).sort()).toEqual([ch.lrA, ch.lrB].sort());
    expect(tasks.every((x) => x.old_vehicle_id === v1 && x.new_vehicle_id === v2 && x.done_at === null)).toBe(true);
    expect(tasks[0].note).toBe("Breakdown at Aurangabad");

    const [c] = await sql`select vehicle_id from challans where id = ${ch.id}`;
    expect(c.vehicle_id).toBe(v2);
    const [{ n }] = await sql`select count(*)::int as n from audit_log
                               where company_id = ${t.companyId} and audit_log::text like ${`%${ch.id}%`}`;
    expect(n).toBeGreaterThan(0);

    // The same vehicle again is refused; so is a stale version.
    await expect(
      challans.changeChallanVehicle(t.companyId, ch.id, r.version, { newVehicleId: v2, reason: "again" }),
    ).rejects.toThrow(/already on this challan/);
    await expect(
      challans.changeChallanVehicle(t.companyId, ch.id, ch.version, { newVehicleId: v1, reason: "stale" }),
    ).rejects.toThrow();
  });

  it("warns when the new vehicle's owner is not the payee, and leaves the payee alone", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const payee = await owner(t.companyId, "Payee Owner");
    const other = await owner(t.companyId, "Other Owner");
    const v1 = await vehicle(t.companyId, "BR01AA3333", payee);
    const v2 = await vehicle(t.companyId, "BR01BB4444", other);
    const ch = await challanWithEwb(t.companyId, v1, payee);
    // payee_kind defaults to owner.
    const r = await challans.changeChallanVehicle(t.companyId, ch.id, ch.version, {
      newVehicleId: v2,
      reason: "Replacement truck",
    });
    expect(r.warnings).toHaveLength(1);
    const [c] = await sql`select payee_party_id from challans where id = ${ch.id}`;
    expect(c.payee_party_id).toBe(payee);
  });

  it("refuses a settled challan", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const v1 = await vehicle(t.companyId, "BR01AA5555");
    const v2 = await vehicle(t.companyId, "BR01BB6666");
    const ch = await challanWithEwb(t.companyId, v1);
    const version = await settleViaPod(t.companyId, ch);
    await expect(
      challans.changeChallanVehicle(t.companyId, ch.id, version,{ newVehicleId: v2, reason: "late" }),
    ).rejects.toThrow(/settled/);
    const [{ n }] = await sql`select count(*)::int as n from ewb_tasks where challan_id = ${ch.id}`;
    expect(n).toBe(0);
  });
});

describe("Part-B tasks: mark done and company isolation", () => {
  it("records who and when; a done task can't be done twice", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const v1 = await vehicle(t.companyId, "BR01AA7777");
    const v2 = await vehicle(t.companyId, "BR01BB8888");
    const ch = await challanWithEwb(t.companyId, v1);
    await challans.changeChallanVehicle(t.companyId, ch.id, ch.version, { newVehicleId: v2, reason: "Tyre burst" });
    const [task] = await sql`select id from ewb_tasks where challan_id = ${ch.id} limit 1`;

    signIn(t.staff, t.companyId);
    const before = Date.now();
    const done = await challans.markEwbTaskDone(t.companyId, task.id as string, "Part-B updated on portal");
    const [row] = await sql`select done_by, done_at, note from ewb_tasks where id = ${task.id}`;
    expect(row.done_by).toBe(t.staff);
    expect(new Date(row.done_at as Date).getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(new Date(done.doneAt).getTime()).toBe(new Date(row.done_at as Date).getTime());
    expect(row.note).toContain("Part-B updated on portal");

    await expect(challans.markEwbTaskDone(t.companyId, task.id as string)).rejects.toThrow();
    const open = await ewbDb.listOpenEwbTasks(t.companyId, ch.id);
    expect(open).toHaveLength(1);
  });

  it("another company can't see or finish them", async () => {
    const a = await fx.team();
    const b = await fx.team();
    signIn(a.owner, a.companyId);
    const v1 = await vehicle(a.companyId, "BR01AA9999");
    const v2 = await vehicle(a.companyId, "BR01BB0000");
    const ch = await challanWithEwb(a.companyId, v1);
    await challans.changeChallanVehicle(a.companyId, ch.id, ch.version, { newVehicleId: v2, reason: "Swap" });
    const [task] = await sql`select id from ewb_tasks where challan_id = ${ch.id} limit 1`;

    const seen = (userId: string) => as(sql, userId, (tx) => tx`select id from ewb_tasks`);
    expect((await seen(a.owner)).length).toBe(2);
    expect(await seen(b.owner)).toHaveLength(0);
    // A driver of the same company isn't office staff either.
    expect(await seen(a.driver)).toHaveLength(0);

    // The other company's owner can't mark it done (no row visible / not a member of company A).
    signIn(b.owner, b.companyId);
    await expect(challans.markEwbTaskDone(b.companyId, task.id as string)).rejects.toThrow();
    await expect(challans.markEwbTaskDone(a.companyId, task.id as string)).rejects.toThrow();
    const [row] = await sql`select done_at from ewb_tasks where id = ${task.id}`;
    expect(row.done_at).toBeNull();
  });
});

/** A draft challan with one LR (10 packages) whose line already has e-way details. */
async function draftChallanWithEwb(companyId: string) {
  const no = `CH-${crypto.randomUUID().slice(0, 6)}`;
  const [b] = await sql`insert into branches (company_id, name) values (${companyId}, ${`Branch ${no}`}) returning id`;
  const [c] = await sql`
    insert into challans (company_id, challan_no, challan_fy, branch_id) values (${companyId}, ${no}, '2026-27', ${b.id})
    returning id, version`;
  const lr = await fx.bookedLr(companyId);
  await sql`insert into lr_items (company_id, lr_id, position, description, packages)
            values (${companyId}, ${lr}, 0, 'Goods', 10)`;
  await sql`insert into challan_lrs (company_id, challan_id, lr_id, loaded_pkgs, ewb_no, ewb_date, ewb_valid_upto, ewb_distance_km)
            values (${companyId}, ${c.id}, ${lr}, 10, ${EWB_A}, '2026-11-10', '2026-11-12T18:30:00.000Z', 300)`;
  return { id: c.id as string, version: c.version as number, branchId: b.id as string, lr };
}

describe("e-way entry per LR line", () => {
  it("saves the fields; only date + distance gives a computed expiry; a typed valid-upto wins", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const v1 = await vehicle(t.companyId, "BR01DD1313");
    const ch = await challanWithEwb(t.companyId, v1);

    const line = await challans.updateChallanLrEwb(t.companyId, ch.id, ch.version, {
      lrId: ch.lrC,
      ewbNo: "444444444444",
      ewbDate: "2026-11-12",
      ewbDistanceKm: 450,
    });
    expect(line).toMatchObject({ ewbNo: "444444444444", ewbDate: "2026-11-12", ewbValidUpto: null, ewbDistanceKm: 450 });
    const [row] = await sql`select ewb_no, ewb_date::text as d, ewb_valid_upto, ewb_distance_km from challan_lrs
                             where challan_id = ${ch.id} and lr_id = ${ch.lrC}`;
    expect(row).toMatchObject({ ewb_no: "444444444444", d: "2026-11-12", ewb_valid_upto: null, ewb_distance_km: 450 });
    const [{ n }] = await sql`select count(*)::int as n from audit_log
                               where company_id = ${t.companyId} and audit_log::text like ${"%444444444444%"}`;
    expect(n).toBeGreaterThan(0);

    // 12 Nov + 450 km at 200 km/day = 3 days → midnight ending 15 Nov (India) = 18:30 UTC.
    const computed = (await ewbDb.listEwbLines(t.companyId)).find((l) => l.lrId === ch.lrC)!;
    expect(computed).toMatchObject({ expirySource: "computed", validUpto: "2026-11-15T18:30:00.000Z" });

    const typed = await challans.updateChallanLrEwb(t.companyId, ch.id, ch.version, {
      lrId: ch.lrC,
      ewbNo: "444444444444",
      ewbDate: "2026-11-12",
      ewbValidUpto: "2026-11-14T10:00",
      ewbDistanceKm: 450,
    });
    expect(typed.ewbValidUpto).toBe("2026-11-14T04:30:00.000Z");
    const entered = (await ewbDb.listEwbLines(t.companyId)).find((l) => l.lrId === ch.lrC)!;
    expect(entered).toMatchObject({ expirySource: "entered", validUpto: "2026-11-14T04:30:00.000Z" });

    // Date without an e-way no., a stale version and a foreign LR are refused.
    await expect(
      challans.updateChallanLrEwb(t.companyId, ch.id, ch.version, { lrId: ch.lrC, ewbDate: "2026-11-12" }),
    ).rejects.toThrow(/e-way no/i);
    await expect(
      challans.updateChallanLrEwb(t.companyId, ch.id, ch.version + 5, { lrId: ch.lrC, ewbNo: "444444444444" }),
    ).rejects.toThrow();
    await expect(
      challans.updateChallanLrEwb(t.companyId, ch.id, ch.version, { lrId: crypto.randomUUID(), ewbNo: "444444444444" }),
    ).rejects.toThrow(/not on this challan/);
  });

  it("a draft re-save keeps the line's e-way fields unless the caller sends them", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const d = await draftChallanWithEwb(t.companyId);
    const base = {
      branchId: d.branchId,
      challanDate: "2026-11-10",
      payeeKind: "owner" as const,
      rateBasis: "trip" as const,
      rate: "1000",
      charges: [],
      action: "draft" as const,
    };
    const lineRow = async () =>
      (await sql`select ewb_no, ewb_date::text as d, ewb_valid_upto, ewb_distance_km from challan_lrs
                  where challan_id = ${d.id} and lr_id = ${d.lr}`)[0];

    const saved = await challans.saveChallan(t.companyId, d.id, d.version, {
      ...base,
      lrs: [{ lrId: d.lr, loadedPkgs: 10 }],
    });
    const kept = await lineRow();
    expect(kept.ewb_no).toBe(EWB_A);
    expect(kept.d).toBe("2026-11-10");
    expect(new Date(kept.ewb_valid_upto as Date).toISOString()).toBe("2026-11-12T18:30:00.000Z");
    expect(kept.ewb_distance_km).toBe(300);
    expect(saved.lrs[0]).toMatchObject({ ewbNo: EWB_A, ewbDate: "2026-11-10", ewbDistanceKm: 300 });

    // Sent values replace; empty values clear.
    const second = await challans.saveChallan(t.companyId, d.id, saved.version, {
      ...base,
      lrs: [{ lrId: d.lr, loadedPkgs: 10, ewbNo: "555555555555", ewbDate: "2026-11-11", ewbValidUpto: "", ewbDistanceKm: "120" }],
    });
    expect(await lineRow()).toMatchObject({ ewb_no: "555555555555", d: "2026-11-11", ewb_valid_upto: null, ewb_distance_km: 120 });
    await challans.saveChallan(t.companyId, d.id, second.version, {
      ...base,
      lrs: [{ lrId: d.lr, loadedPkgs: 10, ewbNo: "", ewbDate: "", ewbValidUpto: "", ewbDistanceKm: "" }],
    });
    expect(await lineRow()).toMatchObject({ ewb_no: null, d: null, ewb_valid_upto: null, ewb_distance_km: null });
  });

  it("a settled challan refuses the edit; a draft allows it", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const v1 = await vehicle(t.companyId, "BR01EE1414");
    const ch = await challanWithEwb(t.companyId, v1);
    const version = await settleViaPod(t.companyId, ch);
    await expect(
      challans.updateChallanLrEwb(t.companyId, ch.id, version,{ lrId: ch.lrA, ewbNo: "666666666666" }),
    ).rejects.toThrow(/settled/);
    const [row] = await sql`select ewb_no from challan_lrs where challan_id = ${ch.id} and lr_id = ${ch.lrA}`;
    expect(row.ewb_no).toBe(EWB_A);

    const d = await draftChallanWithEwb(t.companyId);
    const line = await challans.updateChallanLrEwb(t.companyId, d.id, d.version, { lrId: d.lr, ewbNo: "777777777777" });
    expect(line.ewbNo).toBe("777777777777");
  });
});

describe("e-way lines", () => {
  it("falls back to LR invoice data, computes the expiry from date + distance, marks entered vs computed", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const v1 = await vehicle(t.companyId, "BR01CC1212");
    const ch = await challanWithEwb(t.companyId, v1);

    const lines = (await ewbDb.listEwbLines(t.companyId)).filter((l) => l.challanId === ch.id);
    expect(lines).toHaveLength(2); // LR C has no e-way bill
    const a = lines.find((l) => l.lrId === ch.lrA)!;
    const b = lines.find((l) => l.lrId === ch.lrB)!;

    // A: own line, no valid-upto → computed: 10 Nov + 150 km at 200 km/day (default) = midnight ending 11 Nov.
    expect(a.ewbNo).toBe(EWB_A);
    expect(a.expirySource).toBe("computed");
    expect(a.validUpto).toBe("2026-11-11T18:30:00.000Z");
    // B: LR invoice fallback, entered expiry.
    expect(b.ewbNo).toBe(EWB_B);
    expect(b.expirySource).toBe("entered");
    expect(b.validUpto).toBe("2026-11-20T18:30:00.000Z");

    // A line's own e-way data wins over the invoice; no date / distance → no expiry.
    await sql`update challan_lrs set ewb_no = ${"333333333333"}, ewb_date = null, ewb_distance_km = null
               where challan_id = ${ch.id} and lr_id = ${ch.lrB}`;
    const again = (await ewbDb.listEwbLines(t.companyId)).filter((l) => l.lrId === ch.lrB);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ ewbNo: "333333333333", validUpto: null, expirySource: null });
  });
});

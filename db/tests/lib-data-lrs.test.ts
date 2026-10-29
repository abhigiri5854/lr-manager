// LRs, POD, LR detail and the dashboard on the database (DATA_SOURCE=db, prompt 19b): the real
// lib/data functions, signed in through the session cookie, against the dev database.
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
const lrs = await import("@/lib/data/lrs");
const pod = await import("@/lib/data/pod");
const detail = await import("@/lib/data/lr-detail");
const dashboard = await import("@/lib/data/dashboard");
const { podUrlFromPath } = await import("@/lib/data/db/storage");
const { ConflictError, ForbiddenError, ValidationError } = await import("@/lib/data/errors");

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

const goods = [{ description: "Cement", packages: 40, chargedWeight: "2000" }];
const bookable = (a: string, b: string, extra = {}) => ({
  lrDate: "2026-10-14",
  fromPlace: "Patna",
  toPlace: "Gaya",
  consignorId: a,
  consigneeId: b,
  paymentMode: "tbb" as const,
  items: goods,
  ...extra,
});

describe("LRs on the database", () => {
  it("create a draft and book it: number from the series, snapshot, audit, lines kept", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    const a = await fx.party(t.companyId, "Alpha Traders");
    const b = await fx.party(t.companyId, "Beta Stores");
    const truck = await fx.truck(t.companyId, "BR01GN8331");

    const draft = await lrs.createLr(t.companyId, { fromPlace: "Patna" });
    expect(draft.status).toBe("Draft");
    expect(draft.snapshot).toBeNull();
    const booked = await lrs.createLr(
      t.companyId,
      bookable(a, b, {
        truckId: truck,
        charges: { freight: 1_50_000 },
        lrInvoices: [{ invoiceNo: "INV 1", valuePaise: 9_00_000 }],
      }),
      { book: true },
    );
    expect(booked.status).toBe("Booked");
    expect(Number(booked.lrNo)).toBe(Number(draft.lrNo) + 1);
    expect(booked.snapshot?.consignor?.name).toBe("Alpha Traders");
    expect(booked.consigneeName).toBe("Beta Stores");
    expect(booked.truckNumber).toBe("BR01GN8331");

    const read = (await lrs.getLrById(t.companyId, booked.id))!;
    expect(read.items).toMatchObject([{ description: "Cement", packages: 40, chargedWeight: "2000.000" }]);
    expect(read.lrInvoices).toMatchObject([{ invoiceNo: "INV 1", valuePaise: 9_00_000 }]);
    expect(read.charges.freight).toBe(1_50_000);
    expect(read.totalPackages).toBe(40);

    const audit = await sql`select action, user_id from audit_log where record_id = ${booked.id}`;
    expect(audit.map((x) => x.action)).toEqual(["create"]);
    expect(audit[0].user_id).toBe(t.staff);

    // Booking rules and unknown references fail without taking a number.
    await expect(
      lrs.createLr(t.companyId, { fromPlace: "X" }, { book: true }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(lrs.createLr(t.companyId, { consignorId: crypto.randomUUID() })).rejects.toThrow(
      /Consignor not found/,
    );
    const next = await lrs.createLr(t.companyId, {});
    expect(Number(next.lrNo)).toBe(Number(booked.lrNo) + 1);
  });

  it("edit: a lines-only change still bumps the version; stale version conflicts; draft → booked", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    const a = await fx.party(t.companyId, "Alpha Traders");
    const b = await fx.party(t.companyId, "Beta Stores");
    const lr = await lrs.createLr(t.companyId, bookable(a, b));

    const edited = await lrs.updateLr(t.companyId, lr.id, lr.version, {
      items: [
        { description: "Cement", packages: 41 },
        { description: "Sand", packages: 2 },
      ],
    });
    expect(edited.version).toBe(lr.version + 1);
    expect(edited.items.map((i) => i.packages)).toEqual([41, 2]);
    await expect(
      lrs.updateLr(t.companyId, lr.id, lr.version, { remarks: "late" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const booked = await lrs.updateLr(t.companyId, lr.id, edited.version, {}, { book: true });
    expect(booked.status).toBe("Booked");
    expect(booked.snapshot?.company.name).toBeTruthy();
    expect(booked.items).toHaveLength(2);
    const log = await sql`select action from audit_log where record_id = ${lr.id} order by created_at`;
    expect(log.map((x) => x.action)).toEqual(["create", "update", "update"]);
  });

  it("register: search (incl. truck no.), party / status filters, paging, export", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    const a = await fx.party(t.companyId, "Alpha Traders");
    const b = await fx.party(t.companyId, "Beta Stores");
    const truck = await fx.truck(t.companyId, "BR01GN8331");
    const one = await lrs.createLr(t.companyId, bookable(a, b, { truckId: truck }), { book: true });
    const two = await lrs.createLr(t.companyId, bookable(b, a));
    await lrs.createLr(t.companyId, {});

    expect((await lrs.listLrs(t.companyId, {})).total).toBe(3);
    expect(
      (await lrs.listLrs(t.companyId, { search: "br 01 gn 8331" })).rows.map((r) => r.id),
    ).toEqual([one.id]);
    expect((await lrs.listLrs(t.companyId, { search: "beta" })).total).toBe(2);
    expect(
      (await lrs.listLrs(t.companyId, { partyId: a, status: "Draft" })).rows.map((r) => r.id),
    ).toEqual([two.id]);
    expect((await lrs.listLrs(t.companyId, { status: "Booked" })).total).toBe(1);
    expect((await lrs.listLrs(t.companyId, { pageSize: 2, page: 2 })).rows).toHaveLength(1);
    expect((await lrs.listLrs(t.companyId, { partyId: "not-a-uuid" })).total).toBe(0);
    const out = await lrs.listLrsForExport(t.companyId, { dateFrom: "2026-10-01" });
    expect(out.total).toBe(2);
  });

  it("dispatch needs a truck; cancel needs the owner and a reason; cancelled LRs leave the register", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    const a = await fx.party(t.companyId, "Alpha Traders");
    const b = await fx.party(t.companyId, "Beta Stores");
    const lr = await lrs.createLr(t.companyId, bookable(a, b), { book: true });
    await expect(lrs.dispatchLr(t.companyId, lr.id, lr.version)).rejects.toThrow(/Pick a truck/);
    const truck = await fx.truck(t.companyId, "BR02AB1234");
    const withTruck = await lrs.updateLr(t.companyId, lr.id, lr.version, { truckId: truck });
    const moving = await lrs.dispatchLr(t.companyId, lr.id, withTruck.version);
    expect(moving.status).toBe("In transit");

    await expect(lrs.cancelLr(t.companyId, lr.id, { reason: "wrong" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    signIn(t.owner, t.companyId);
    await expect(lrs.cancelLr(t.companyId, lr.id, { reason: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const gone = await lrs.cancelLr(t.companyId, lr.id, { reason: "booked twice" });
    expect(gone.status).toBe("Cancelled");
    expect((await lrs.listLrs(t.companyId, {})).total).toBe(0);
    expect((await lrs.listLrs(t.companyId, { status: "Cancelled" })).total).toBe(1);
    await expect(
      lrs.updateLr(t.companyId, lr.id, gone.version, { remarks: "x" }),
    ).rejects.toThrow(/cancelled/);
  });

  it("a final freight bill locks the LR", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const a = await fx.party(t.companyId, "Alpha Traders");
    const b = await fx.party(t.companyId, "Beta Stores");
    const lr = await lrs.createLr(t.companyId, bookable(a, b), { book: true });
    await fx.finalBill(t.companyId, a, [lr.id], 1_000_00);
    const now = (await lrs.getLrById(t.companyId, lr.id))!;
    expect(now.status).toBe("Billed");
    await expect(
      lrs.updateLr(t.companyId, lr.id, now.version, { remarks: "x" }),
    ).rejects.toThrow(/locked/);
    await expect(lrs.cancelLr(t.companyId, lr.id, { reason: "oops" })).rejects.toThrow(
      /freight bill/,
    );
    const d = (await detail.getLrDetail(t.companyId, lr.id))!;
    expect(d.bill?.billNo).toMatch(/^FB-/);
  });

  it("consignor defaults, consignee 'To' and duplicate invoice lookups", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    const a = await fx.party(t.companyId, "Alpha Traders");
    const b = await fx.party(t.companyId, "Beta Stores");
    expect(await lrs.getConsignorDefaults(t.companyId, a)).toBeNull();
    const lr = await lrs.createLr(
      t.companyId,
      bookable(a, b, { chargedAs: "ftl", lrInvoices: [{ invoiceNo: "sq 2604-1" }] }),
      { book: true },
    );
    expect(await lrs.getConsignorDefaults(t.companyId, a)).toMatchObject({
      lrId: lr.id,
      fromPlace: "Patna",
      chargedAs: "ftl",
    });
    expect(await lrs.getConsigneeToPlace(t.companyId, b)).toBe("Gaya");
    expect(await lrs.findLrsWithInvoice(t.companyId, { invoiceNo: "SQ2604-1" })).toEqual([
      { id: lr.id, lrNo: lr.lrNo },
    ]);
    expect(await lrs.findLrsWithInvoice(t.companyId, { invoiceNo: "SQ2604-1" }, lr.id)).toEqual(
      [],
    );
    expect(await lrs.peekNextLrNo(t.companyId)).toBe(String(Number(lr.lrNo) + 1));
  });
});

describe("POD on the database", () => {
  async function dispatched(t: Awaited<ReturnType<Fixtures["team"]>>) {
    const a = await fx.party(t.companyId, "Alpha Traders");
    const b = await fx.party(t.companyId, "Beta Stores");
    const truck = await fx.truck(t.companyId, `BR03CD${Math.floor(1000 + Math.random() * 9000)}`);
    const lr = await lrs.createLr(t.companyId, bookable(a, b, { truckId: truck }), { book: true });
    return lrs.dispatchLr(t.companyId, lr.id, lr.version);
  }

  it("delivery → pending → signed copy → POD received; cancel puts it back", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    const lr = await dispatched(t);
    expect((await pod.listInTransitForPod(t.companyId, {})).rows.map((r) => r.id)).toEqual([lr.id]);

    const delivered = await pod.createPod(t.companyId, { lrId: lr.id, deliveredOn: "2026-10-20" });
    expect(delivered.receivedAt).toBeNull();
    let now = (await lrs.getLrById(t.companyId, lr.id))!;
    expect(now.status).toBe("Delivered");
    expect(now.deliveredAt).toBe("2026-10-20T00:00:00.000Z");
    expect((await pod.listInTransitForPod(t.companyId, {})).total).toBe(0);
    const pending = await pod.listPodPendingPage(t.companyId, {});
    expect(pending.rows).toMatchObject([
      { lrId: lr.id, deliveredOn: "2026-10-20", consignee: "Beta Stores" },
    ]);
    await expect(
      pod.createPod(t.companyId, { lrId: lr.id, deliveredOn: "2026-10-20" }),
    ).rejects.toThrow(/already has a POD/);

    const url = podUrlFromPath(`${t.companyId}/${lr.id}/${crypto.randomUUID()}-signed.png`);
    const received = await pod.updatePod(t.companyId, delivered.id, delivered.version, {
      documentUrls: [url],
      condition: "good",
    });
    expect(received.receivedAt).toBeTruthy();
    expect(received.documentUrls).toEqual([url]);
    now = (await lrs.getLrById(t.companyId, lr.id))!;
    expect(now.status).toBe("POD received");
    expect((await pod.listPodPendingPage(t.companyId, {})).total).toBe(0);
    await expect(
      pod.updatePod(t.companyId, delivered.id, delivered.version, { remarks: "stale" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const foreign = podUrlFromPath(
      `${t.companyId}/${crypto.randomUUID()}/${crypto.randomUUID()}-x.png`,
    );
    await expect(
      pod.updatePod(t.companyId, delivered.id, received.version, { documentUrls: [foreign] }),
    ).rejects.toBeInstanceOf(ValidationError);

    const screen = (await pod.getPodScreen(t.companyId, lr.id))!;
    expect(screen.pod?.id).toBe(delivered.id);
    const d = (await detail.getLrDetail(t.companyId, lr.id))!;
    expect(d.pod?.documentUrls).toEqual([url]);
    expect(d.activity.map((x) => x.text)).toEqual(
      expect.arrayContaining(["POD recorded", "POD updated", "LR created"]),
    );

    signIn(t.owner, t.companyId);
    await pod.cancelPod(t.companyId, delivered.id);
    now = (await lrs.getLrById(t.companyId, lr.id))!;
    expect(now.status).toBe("In transit");
    expect(now.deliveredAt).toBeNull();
  });

  it("short / damaged need remarks; any delivery date is accepted", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    const lr = await dispatched(t);
    await expect(
      pod.createPod(t.companyId, { lrId: lr.id, deliveredOn: "2026-10-20", condition: "short" }),
    ).rejects.toThrow(/Add remarks/);
    // Before the LR date (and in the future) is only a warning on the form.
    const early = await pod.createPod(t.companyId, { lrId: lr.id, deliveredOn: "2026-10-01" });
    const later = await pod.updatePod(t.companyId, early.id, early.version, {
      deliveredOn: "2999-01-01",
    });
    expect((await lrs.getLrById(t.companyId, lr.id))!.deliveredAt).toBe("2999-01-01T00:00:00.000Z");
    expect(later.version).toBe(early.version + 1);
  });

  it("a driver records POD only on their own trip", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    const mine = await dispatched(t);
    const other = await dispatched(t);
    await fx.driver(t.companyId, "9123456780", t.driver);
    await sql`update lrs set driver_mobile = '9123456780' where id = ${mine.id}`;
    signIn(t.driver, t.companyId);
    const ok = await pod.createPod(t.companyId, { lrId: mine.id, deliveredOn: "2026-10-20" });
    expect(ok.lrId).toBe(mine.id);
    await expect(
      pod.createPod(t.companyId, { lrId: other.id, deliveredOn: "2026-10-20" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("dashboard: counts, e-way and POD alerts, recent LRs, repeat routes", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    const a = await fx.party(t.companyId, "Alpha Traders");
    const b = await fx.party(t.companyId, "Beta Stores");
    const truck = await fx.truck(t.companyId, "BR04EF9012");
    await lrs.createLr(t.companyId, {});
    const moving = await lrs.createLr(
      t.companyId,
      bookable(a, b, {
        truckId: truck,
        lrInvoices: [
          {
            invoiceNo: "I-1",
            ewayBillNo: "123456789012",
            ewayExpiresAt: new Date(Date.now() - 3_600_000).toISOString(),
          },
        ],
      }),
      { book: true },
    );
    await lrs.dispatchLr(t.companyId, moving.id, moving.version);
    const second = await lrs.createLr(t.companyId, bookable(a, b), { book: true });
    await pod.createPod(t.companyId, { lrId: second.id, deliveredOn: "2026-10-15" });
    await sql`update companies set pod_days = 7, pod_penalty_per_day_paise = 50000
               where id = ${t.companyId}`;

    signIn(t.owner, t.companyId);
    const d = await dashboard.getDashboard(t.companyId);
    expect(d.openLrs).toMatchObject({ total: 2, draft: 1, booked: 0, inTransit: 1 });
    expect(d.eway).toEqual({ total: 1, expired: 1 });
    expect(d.pod).toEqual({ pending: 1, podDays: 7 });
    expect(d.freight).toEqual({ toCollectPaise: null, unbilledTbbLrs: 2 });
    expect(d.recentLrs).toHaveLength(3);
    expect(d.repeatRoutes).toMatchObject([{ consignorName: "Alpha Traders", count: 2 }]);
    expect(d.attention.map((x) => x.kind)).toEqual(
      expect.arrayContaining(["eway_expired", "pod_overdue", "draft_incomplete"]),
    );
  });
});

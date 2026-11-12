// Driver links on the database (0023_driver_links.sql): the owner's link (resend = same URL, one active
// link, revoke / expiry), the session-less token side (own challans only, other company impossible,
// settled refuses, never money but the advance), the driver's POD reaching the challan, and staff
// trip events. Real lib/data functions; Storage uploads are stubbed (paths recorded, nothing sent).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/driver-link";
import { Fixtures, as, connect, pgError, type Sql } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
const stored = vi.hoisted(() => [] as string[]);
const deleted = vi.hoisted(() => [] as string[]);
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
vi.mock("@/lib/data/db/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/db/storage")>()),
  putObject: async (_bucket: string, path: string) => void stored.push(path),
  deleteObject: async (_bucket: string, path: string) => void deleted.push(path),
}));

process.env.DATA_SOURCE = "db";
process.env.DRIVER_LINK_SECRET ??= "db-tests-driver-link-secret-0123456789abcdef";
process.env.APP_BASE_URL ??= "https://lr.test";

const session = await import("@/lib/data/session");
const dl = await import("@/lib/data/driver-links");
const pods = await import("@/lib/data/pod");
const { ForbiddenError } = await import("@/lib/data/errors");

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
/** The driver's phone: no session at all. */
const signOut = () => jar.clear();

const india = (date: string) => new Date(`${date}T00:00:00+05:30`).toISOString();
const tokenOf = (url: string) => url.split("/d/")[1];
const png = {
  name: "pod.png",
  type: "image/png",
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
};
const PATNA = { lat: 25.5941, lng: 85.1376, accuracyM: 12 };

async function marketDriver(companyId: string, name = `Driver ${crypto.randomUUID().slice(0, 4)}`) {
  const [d] = await sql`insert into market_drivers (company_id, name, mobile) values (${companyId}, ${name}, '9000000001')
                        returning id`;
  return d.id as string;
}

/** A dispatched challan (as the system) for this market driver, 10 packages per LR; hire 76543.21. */
async function challan(companyId: string, driverId: string, lrIds: string[], ageDays = 0) {
  const no = `CH-${crypto.randomUUID().slice(0, 6)}`;
  const at = new Date(Date.now() - ageDays * 86_400_000).toISOString();
  const [b] = await sql`insert into branches (company_id, name) values (${companyId}, ${`Branch ${no}`}) returning id`;
  const [c] = await sql`
    insert into challans (company_id, challan_no, challan_fy, branch_id, rate, hire_amount, driver_id,
                          source, destination, challan_at)
    values (${companyId}, ${no}, '2026-27', ${b.id}, 76543.21, 76543.21, ${driverId}, 'Patna', 'Kolkata', ${at})
    returning id`;
  for (const lrId of lrIds)
    await sql`insert into challan_lrs (company_id, challan_id, lr_id, loaded_pkgs, freight_allocated)
              values (${companyId}, ${c.id}, ${lrId}, 10, 12345.67)`;
  await sql`update challans set status = 'dispatched', dispatched_at = ${india("2026-10-15")} where id = ${c.id}`;
  return { id: c.id as string, no };
}

/** pod_received, then settled `daysAgo` days ago (as the system). */
async function settle(challanId: string, daysAgo = 0) {
  await sql`update challans set status = 'pod_received', unloaded_at = now() - interval '10 days',
                                pod_received_at = now() - interval '9 days'
             where id = ${challanId}`;
  await sql`update challans set status = 'settled', settled_at = now() - make_interval(days => ${daysAgo}::int)
             where id = ${challanId}`;
}

/** Settled `daysAgo` days ago, with POD and dispatch dates consistent with that (as the system). */
async function settleLong(challanId: string, daysAgo: number) {
  await sql`update challans set status = 'pod_received',
                   dispatched_at = now() - make_interval(days => ${daysAgo + 4}::int),
                   unloaded_at = now() - make_interval(days => ${daysAgo + 2}::int),
                   pod_received_at = now() - make_interval(days => ${daysAgo + 1}::int)
             where id = ${challanId}`;
  await sql`update challans set status = 'settled', settled_at = now() - make_interval(days => ${daysAgo}::int)
             where id = ${challanId}`;
}

/** A team, one market driver with a link, one LR on a dispatched challan of theirs. */
async function setup() {
  const t = await fx.team();
  signIn(t.owner, t.companyId);
  const driver = await marketDriver(t.companyId);
  const lr = await fx.bookedLr(t.companyId);
  const ch = await challan(t.companyId, driver, [lr]);
  const link = await dl.getOrCreateDriverLink(t.companyId, driver);
  return { t, driver, lr, ch, link, token: tokenOf(link.url) };
}

describe("owner side: the driver's link", () => {
  it("resend returns the same URL; max one active link; revoke kills it and a new one differs", async () => {
    const { t, driver, link, token } = await setup();
    expect(link.url).toMatch(/^https:\/\/lr\.test\/d\/[A-Za-z0-9_-]{43}$/);
    const again = await dl.getOrCreateDriverLink(t.companyId, driver);
    expect(again.url).toBe(link.url);

    const rows = await sql`select id, token_hash, token_enc from driver_links where market_driver_id = ${driver}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashToken(token));
    expect(rows[0].token_enc).not.toContain(token);

    // The database itself refuses a second active link for the driver.
    const dup = await pgError(sql`
      insert into driver_links (company_id, market_driver_id, token_hash, token_enc)
      values (${t.companyId}, ${driver}, ${"0".repeat(64)}, 'v1.x')`);
    expect(dup.code).toBe("23505");

    expect(await dl.revokeDriverLink(t.companyId, driver)).toEqual({ revoked: true });
    expect(await dl.revokeDriverLink(t.companyId, driver)).toEqual({ revoked: false });
    expect(await dl.openDriverLink(token)).toBeNull();
    const fresh = await dl.getOrCreateDriverLink(t.companyId, driver);
    expect(fresh.url).not.toBe(link.url);
    expect(await dl.openDriverLink(tokenOf(fresh.url))).not.toBeNull();

    const audit = await sql`select action, actor from audit_log
                             where company_id = ${t.companyId} and table_name = 'driver_links'`;
    expect(audit.filter((a) => a.action === "create")).toHaveLength(2);
    expect(audit.some((a) => a.action === "update")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("needs master.edit: a driver login is refused", async () => {
    const { t, driver } = await setup();
    signIn(t.driver, t.companyId);
    await expect(dl.getOrCreateDriverLink(t.companyId, driver)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(dl.revokeDriverLink(t.companyId, driver)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("token side: revoked / expired", () => {
  it("an expired token gets nothing; the owner's next link replaces it", async () => {
    const { t, driver, lr, ch, token } = await setup();
    signOut();
    const info = await dl.openDriverLink(token);
    expect(info?.driverName).toMatch(/^Driver /);
    expect(info?.companyName).toBeTruthy();
    const [{ last_opened_at }] = await sql`select last_opened_at from driver_links where market_driver_id = ${driver}`;
    expect(last_opened_at).not.toBeNull();

    await sql`update driver_links set expires_at = now() - interval '1 minute' where market_driver_id = ${driver}`;
    expect(await dl.openDriverLink(token)).toBeNull();
    expect(await dl.driverTrips(token)).toBeNull();
    await expect(dl.recordDriverEvent(token, { challanId: ch.id, type: "loaded", ...PATNA })).rejects.toBeInstanceOf(
      dl.DriverLinkError,
    );
    await expect(dl.uploadDriverPod(token, ch.id, lr, png)).rejects.toBeInstanceOf(dl.DriverLinkError);

    signIn(t.owner, t.companyId);
    const fresh = await dl.getOrCreateDriverLink(t.companyId, driver);
    expect(tokenOf(fresh.url)).not.toBe(token);
    const links = await sql`select revoked_at from driver_links where market_driver_id = ${driver} order by created_at`;
    expect(links).toHaveLength(2);
    expect(links[0].revoked_at).not.toBeNull();
    expect(links[1].revoked_at).toBeNull();
  });

  it("a revoked token gets nothing and can't write", async () => {
    const { t, driver, lr, ch, token } = await setup();
    await dl.revokeDriverLink(t.companyId, driver);
    signOut();
    expect(await dl.driverTrips(token)).toBeNull();
    await expect(dl.recordDriverEvent(token, { challanId: ch.id, type: "loaded", ...PATNA })).rejects.toBeInstanceOf(
      dl.DriverLinkError,
    );
    await expect(dl.uploadDriverPod(token, ch.id, lr, png)).rejects.toBeInstanceOf(dl.DriverLinkError);
    const [{ n }] = await sql`select count(*)::int as n from trip_events where challan_id = ${ch.id}`;
    expect(n).toBe(0);
    // A token that never existed (right shape) is the same as a revoked one.
    expect(await dl.openDriverLink("B".repeat(43))).toBeNull();
  });
});

describe("token side: own trips only", () => {
  it("driver A can't see or act on driver B's challan", async () => {
    const { t, lr, ch, token } = await setup();
    const driverB = await marketDriver(t.companyId, "Driver B");
    const lrB = await fx.bookedLr(t.companyId);
    const chB = await challan(t.companyId, driverB, [lrB]);
    signOut();

    const mine = await dl.driverTrips(token);
    expect(mine!.trips.map((x) => x.challanId)).toEqual([ch.id]);
    expect(mine!.trips[0].lrs.map((l) => l.lrId)).toEqual([lr]);

    const before = stored.length;
    await expect(dl.recordDriverEvent(token, { challanId: chB.id, type: "loaded", ...PATNA })).rejects.toBeInstanceOf(
      dl.DriverLinkError,
    );
    await expect(dl.uploadDriverPod(token, chB.id, lrB, png)).rejects.toBeInstanceOf(dl.DriverLinkError);
    // B's LR through A's own challan: not on it.
    await expect(dl.uploadDriverPod(token, ch.id, lrB, png)).rejects.toBeInstanceOf(dl.DriverLinkError);
    expect(stored.length).toBe(before); // nothing stored for a refused trip
    const [{ n }] = await sql`select count(*)::int as n from trip_events where challan_id = ${chB.id}`;
    expect(n).toBe(0);
    const [{ p }] = await sql`select count(*)::int as p from pods where lr_id in (${lr}, ${lrB})`;
    expect(p).toBe(0);
  });

  it("another company's challan is impossible, and its owner can't read these events", async () => {
    const { t, ch, token } = await setup();
    const other = await fx.team();
    const otherDriver = await marketDriver(other.companyId);
    const otherLr = await fx.bookedLr(other.companyId);
    const otherCh = await challan(other.companyId, otherDriver, [otherLr]);
    signOut();
    await expect(
      dl.recordDriverEvent(token, { challanId: otherCh.id, type: "loaded", ...PATNA }),
    ).rejects.toBeInstanceOf(dl.DriverLinkError);
    await expect(dl.uploadDriverPod(token, otherCh.id, otherLr, png)).rejects.toBeInstanceOf(dl.DriverLinkError);
    expect((await dl.driverTrips(token))!.trips.map((x) => x.challanId)).toEqual([ch.id]);

    await dl.recordDriverEvent(token, { challanId: ch.id, type: "loaded", ...PATNA });
    signIn(other.owner, other.companyId);
    expect(await dl.listTripEvents(other.companyId, ch.id)).toEqual([]);
    signIn(t.owner, t.companyId);
    expect(await dl.listTripEvents(t.companyId, ch.id)).toHaveLength(1);
  });
});

describe("token side: settled challans", () => {
  it("settled recently: shown read-only, refuses events and POD; settled long ago: not shown", async () => {
    const { t, driver, lr, ch, token } = await setup();
    const oldLr = await fx.bookedLr(t.companyId);
    const old = await challan(t.companyId, driver, [oldLr]);
    await settle(ch.id, 1);
    await settle(old.id, 4);
    signOut();

    const { trips } = (await dl.driverTrips(token))!;
    expect(trips.map((x) => x.challanId)).toEqual([ch.id]);
    expect(trips[0]).toMatchObject({ readOnly: true, status: "settled", podStatus: "settled" });

    const before = stored.length;
    await expect(dl.recordDriverEvent(token, { challanId: ch.id, type: "reached", ...PATNA })).rejects.toThrow(
      /settled/,
    );
    await expect(dl.uploadDriverPod(token, ch.id, lr, png, { packages: 10 })).rejects.toThrow(/settled/);
    expect(stored.length).toBe(before);
    const [{ n }] = await sql`select count(*)::int as n from trip_events where challan_id = ${ch.id}`;
    expect(n).toBe(0);
  });
});

describe("token side: POD from the link", () => {
  it("attaches to the LR's POD and moves the challan to pod_received; a second photo is added", async () => {
    const { t, lr, ch, token } = await setup();
    signOut();
    const res = await dl.uploadDriverPod(token, ch.id, lr, png, { deliveredOn: "2026-10-19", packages: 10 });
    expect(res.challanStatus).toBe("pod_received");
    expect(res.packagesReceived).toBe(10);
    expect(res.deliveredOn).toBe("2026-10-19");
    expect(stored.at(-1)).toMatch(new RegExp(`^${t.companyId}/${lr}/[0-9a-f-]{36}-pod\\.png$`));
    expect(res.documentUrls).toHaveLength(1);
    expect(res.documentUrls[0]).toContain(`l=${lr}`);

    const [c] = await sql`select status, unloaded_at, pod_received_at from challans where id = ${ch.id}`;
    expect(c.status).toBe("pod_received");
    expect(new Date(c.unloaded_at).toISOString()).toBe(india("2026-10-19"));
    expect(c.pod_received_at).not.toBeNull();
    const [line] = await sql`select delivered_pkgs from challan_lrs where challan_id = ${ch.id} and lr_id = ${lr}`;
    expect(line.delivered_pkgs).toBe(10);
    const [l] = await sql`select delivered_at from lrs where id = ${lr}`;
    expect(new Date(l.delivered_at).toISOString()).toBe("2026-10-19T00:00:00.000Z");

    const second = await dl.uploadDriverPod(token, ch.id, lr, { ...png, name: "pod-2.png" });
    expect(second.documentUrls).toHaveLength(2);
    expect(second.deliveredOn).toBe("2026-10-19"); // kept

    // The office sees the same POD; audit rows are the system's, naming the link.
    signIn(t.owner, t.companyId);
    const pod = (await pods.getPodByLrId(t.companyId, lr))!;
    expect(pod.documentUrls).toHaveLength(2);
    expect(pod.packagesReceived).toBe(10);
    const audit = await sql`select table_name, actor, user_id, reason from audit_log
                             where company_id = ${t.companyId} and reason like 'Driver link %'`;
    expect(new Set(audit.map((a) => a.table_name))).toEqual(new Set(["pods", "lrs", "challans"]));
    expect(audit.every((a) => a.actor === "system" && a.user_id === null)).toBe(true);
  });

  it("more packages than loaded, or a future delivery date, is refused and nothing is saved", async () => {
    const { lr, ch, token } = await setup();
    signOut();
    await expect(dl.uploadDriverPod(token, ch.id, lr, png, { packages: 11 })).rejects.toThrow(/loaded 10 packages/);
    await expect(dl.uploadDriverPod(token, ch.id, lr, png, { deliveredOn: "2999-01-01" })).rejects.toThrow(/future/);
    const [{ n }] = await sql`select count(*)::int as n from pods where lr_id = ${lr}`;
    expect(n).toBe(0);
    const [c] = await sql`select status from challans where id = ${ch.id}`;
    expect(c.status).toBe("dispatched");
  });

  it("a non-image / non-PDF file is refused before anything is stored", async () => {
    const { lr, ch, token } = await setup();
    signOut();
    const before = stored.length;
    const html = { name: "x.pdf", type: "application/pdf", bytes: new TextEncoder().encode("<html>") };
    await expect(dl.uploadDriverPod(token, ch.id, lr, html)).rejects.toThrow(/doesn't look like/);
    expect(stored.length).toBe(before);
  });
});

describe("trips never carry money but the advance", () => {
  it("no hire, freight, rate, margin or balance anywhere in the payload", async () => {
    const { token, ch } = await setup();
    await sql`update lrs set freight_paise = 1234567 where id in (select lr_id from challan_lrs where challan_id = ${ch.id})`;
    signOut();
    const res = (await dl.driverTrips(token))!;
    expect(res.trips).toHaveLength(1);
    const trip = res.trips[0];
    expect(trip.advancePaid).toBe("0.00");
    expect(trip).toMatchObject({ source: "Patna", destination: "Kolkata", podStatus: "pending", readOnly: false });
    expect(trip.lrs[0].packages).toBe(10);

    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          keys.push(k);
          walk(x);
        }
    };
    walk(res);
    expect(keys.filter((k) => /hire|freight|rate|margin|balance|amount|paise|payable|tds/i.test(k))).toEqual([]);
    const json = JSON.stringify(res);
    expect(json).not.toContain("76543");
    expect(json).not.toContain("12345.67");
    expect(json).not.toContain("1234567");
  });
});

describe("trip events", () => {
  it("staff events work; the driver's repeated event updates its one row; staff can't fake a driver event", async () => {
    const { t, ch, token } = await setup();
    const s1 = await dl.addStaffTripEvent(t.companyId, ch.id, "loaded", "Loaded at plant");
    expect(s1).toMatchObject({ source: "staff", type: "loaded", lat: null, createdBy: t.owner, note: "Loaded at plant" });
    const s2 = await dl.addStaffTripEvent(t.companyId, ch.id, "loaded", "Reloaded");
    expect(s2.id).toBe(s1.id);
    expect(s2.note).toBe("Reloaded");

    signOut();
    const e1 = await dl.recordDriverEvent(token, { challanId: ch.id, type: "reached", ...PATNA });
    expect(e1).toMatchObject({ source: "driver_link", type: "reached", lat: 25.5941, lng: 85.1376, accuracyM: 12 });
    const e2 = await dl.recordDriverEvent(token, { challanId: ch.id, type: "reached", lat: 25.6, lng: 85.2 });
    expect(e2.id).toBe(e1.id);
    expect(e2).toMatchObject({ lat: 25.6, lng: 85.2, accuracyM: null });
    const trips = (await dl.driverTrips(token))!.trips;
    expect(trips[0].events.map((e) => `${e.type}/${e.source}`).sort()).toEqual(["loaded/staff", "reached/driver_link"]);

    signIn(t.staff, t.companyId);
    const list = await dl.listTripEvents(t.companyId, ch.id);
    expect(list.map((e) => `${e.type}/${e.source}`).sort()).toEqual(["loaded/staff", "reached/driver_link"]);

    // RLS: office users insert staff events only.
    const [link] = await sql`select id from driver_links where company_id = ${t.companyId}`;
    const fake = await pgError(
      as(sql, t.staff, (tx) => tx`
        insert into trip_events (company_id, challan_id, type, source, driver_link_id, lat, lng)
        values (${t.companyId}, ${ch.id}, 'en_route', 'driver_link', ${link.id}, 1, 1)`),
    );
    expect(fake.code).toBe("42501");
    // The service functions aren't callable by signed-in users.
    const direct = await pgError(as(sql, t.owner, (tx) => tx`select app.driver_trips(${hashToken(token)})`));
    expect(direct.code).toBe("42501");

    // A driver login (the app) can't add staff events.
    signIn(t.driver, t.companyId);
    await expect(dl.addStaffTripEvent(t.companyId, ch.id, "en_route")).rejects.toBeInstanceOf(ForbiddenError);

    const audit = await sql`select actor, action from audit_log
                             where company_id = ${t.companyId} and table_name = 'trip_events' order by created_at`;
    expect(audit.filter((a) => a.actor === "user").map((a) => a.action)).toEqual(["create", "update"]);
    expect(audit.filter((a) => a.actor === "system").map((a) => a.action)).toEqual(["create", "update"]);
  });

  it("a driver event without location is still saved, location null", async () => {
    const { ch, token } = await setup();
    signOut();
    const e = await dl.recordDriverEvent(token, { challanId: ch.id, type: "loaded" });
    expect(e).toMatchObject({ source: "driver_link", type: "loaded", lat: null, lng: null, accuracyM: null });
    // Half a location (or accuracy alone) counts as none.
    const half = await dl.recordDriverEvent(token, { challanId: ch.id, type: "en_route", lat: 25.5, accuracyM: 8 });
    expect(half).toMatchObject({ lat: null, lng: null, accuracyM: null });
    const [row] = await sql`select lat, lng, accuracy_m from trip_events where id = ${e.id}`;
    expect(row).toMatchObject({ lat: null, lng: null, accuracy_m: null });
    // A later event with a location replaces the empty one.
    const again = await dl.recordDriverEvent(token, { challanId: ch.id, type: "loaded", ...PATNA });
    expect(again.id).toBe(e.id);
    expect(again).toMatchObject({ lat: 25.5941, lng: 85.1376 });
  });

  it("a repeated driver event without location keeps the stored location", async () => {
    const { ch, token } = await setup();
    signOut();
    const e1 = await dl.recordDriverEvent(token, { challanId: ch.id, type: "loaded", ...PATNA });
    const e2 = await dl.recordDriverEvent(token, { challanId: ch.id, type: "loaded" });
    expect(e2.id).toBe(e1.id);
    expect(e2).toMatchObject({ lat: 25.5941, lng: 85.1376, accuracyM: 12 });
    const [row] = await sql`select lat, lng, accuracy_m from trip_events where id = ${e1.id}`;
    expect(Number(row.lat)).toBe(25.5941);
    expect(Number(row.lng)).toBe(85.1376);
    expect(Number(row.accuracy_m)).toBe(12);
  });

  it("a draft or cancelled challan takes no staff event", async () => {
    const { t, driver } = await setup();
    const [b] = await sql`insert into branches (company_id, name) values (${t.companyId}, 'Draft branch') returning id`;
    const [draft] = await sql`
      insert into challans (company_id, challan_no, challan_fy, branch_id, driver_id)
      values (${t.companyId}, 'DRAFT-1', '2026-27', ${b.id}, ${driver}) returning id`;
    await expect(dl.addStaffTripEvent(t.companyId, draft.id as string, "loaded")).rejects.toThrow(/not found/);
  });
});

describe("POD file cleanup", () => {
  it("a file stored but refused by the database is deleted again", async () => {
    const { lr, ch, token } = await setup();
    signOut();
    const before = stored.length;
    const deletedBefore = deleted.length;
    await expect(dl.uploadDriverPod(token, ch.id, lr, png, { packages: 11 })).rejects.toThrow(/loaded 10 packages/);
    expect(stored.length).toBe(before + 1); // it was stored (the check passed) …
    expect(deleted.length).toBe(deletedBefore + 1); // … then removed
    expect(deleted.at(-1)).toBe(stored.at(-1));
    // A successful upload deletes nothing.
    await dl.uploadDriverPod(token, ch.id, lr, png, { packages: 10 });
    expect(deleted.length).toBe(deletedBefore + 1);
  });
});

describe("last seen (ping)", () => {
  it("saves a ping; a second within 5 minutes is ignored; later it saves again; the owner sees it", async () => {
    const { t, driver, token } = await setup();
    const lastSeen = async () =>
      (await sql`select last_lat, last_lng, last_accuracy_m, last_located_at from driver_links
                  where market_driver_id = ${driver}`)[0];
    signOut();
    expect(await dl.recordDriverPing(token, 25.5941, 85.1376, 12)).toBe(true);
    let row = await lastSeen();
    expect(Number(row.last_lat)).toBe(25.5941);
    expect(Number(row.last_lng)).toBe(85.1376);
    expect(Number(row.last_accuracy_m)).toBe(12);
    const firstAt = new Date(row.last_located_at).getTime();

    expect(await dl.recordDriverPing(token, 26.1, 86.1, 5)).toBe(false);
    row = await lastSeen();
    expect(Number(row.last_lat)).toBe(25.5941);
    expect(new Date(row.last_located_at).getTime()).toBe(firstAt);

    await sql`update driver_links set last_located_at = now() - interval '6 minutes' where market_driver_id = ${driver}`;
    expect(await dl.recordDriverPing(token, 26.1, 86.1)).toBe(true);
    row = await lastSeen();
    expect(Number(row.last_lat)).toBe(26.1);
    expect(row.last_accuracy_m).toBeNull();

    // No audit rows for pings.
    const audit = await sql`select count(*)::int as n from audit_log
                             where company_id = ${t.companyId} and table_name = 'driver_links' and actor = 'system'`;
    expect(audit[0].n).toBe(0);

    signIn(t.owner, t.companyId);
    const status = (await dl.getDriverLinkStatus(t.companyId, driver))!;
    expect(status).toMatchObject({ status: "active", lastLat: 26.1, lastLng: 86.1 });
    expect(status.lastLocatedAt).not.toBeNull();
  });

  it("a ping on a revoked link is ignored; the owner sees it revoked", async () => {
    const { t, driver, token } = await setup();
    await dl.revokeDriverLink(t.companyId, driver);
    signOut();
    expect(await dl.recordDriverPing(token, 25.5941, 85.1376, 12)).toBe(false);
    const [row] = await sql`select last_lat, last_located_at from driver_links where market_driver_id = ${driver}`;
    expect(row.last_lat).toBeNull();
    expect(row.last_located_at).toBeNull();

    signIn(t.owner, t.companyId);
    expect((await dl.getDriverLinkStatus(t.companyId, driver))!.status).toBe("revoked");
    // A driver login has no freight.view… but a driver with no link yet gets null for an owner.
    const other = await marketDriver(t.companyId);
    expect(await dl.getDriverLinkStatus(t.companyId, other)).toBeNull();
  });
});

describe("driver history", () => {
  it("respects the company's day limit and shows only this driver's own trips", async () => {
    const { t, driver, ch, token } = await setup(); // ch: live, today
    await sql`update companies set driver_history_days = 30 where id = ${t.companyId}`;

    const inside = await challan(t.companyId, driver, [await fx.bookedLr(t.companyId)], 12);
    const outside = await challan(t.companyId, driver, [await fx.bookedLr(t.companyId)], 50);
    const cancelled = await challan(t.companyId, driver, [await fx.bookedLr(t.companyId)], 6);
    await settleLong(inside.id, 10);
    await settleLong(outside.id, 40);
    await sql`update challans set cancelled_at = now() - interval '5 days', cancel_reason = 'Truck broke down'
               where id = ${cancelled.id}`;

    // Another driver of the same company, and another company's driver: settled, inside the window.
    const driverB = await marketDriver(t.companyId, "Driver B");
    const chB = await challan(t.companyId, driverB, [await fx.bookedLr(t.companyId)], 8);
    await settleLong(chB.id, 7);
    const other = await fx.team();
    const otherDriver = await marketDriver(other.companyId);
    const chO = await challan(other.companyId, otherDriver, [await fx.bookedLr(other.companyId)], 8);
    await settleLong(chO.id, 7);

    signOut();
    const h = (await dl.driverHistory(token))!;
    expect(h.historyDays).toBe(30);
    expect(h.trips.map((x) => x.challanNo)).toEqual([cancelled.no, inside.no]); // newest first
    expect(h.trips[0]).toMatchObject({ status: "cancelled", source: "Patna", destination: "Kolkata" });
    expect(h.trips[1]).toMatchObject({ status: "settled", podDone: true });
    const shown = h.trips.map((x) => x.challanNo);
    expect(shown).not.toContain(outside.no);
    expect(shown).not.toContain(chB.no);
    expect(shown).not.toContain(chO.no);
    expect(shown).not.toContain(ch.no); // live trips are on the main page, not history
    expect(h.podsPending).toBe(1); // the live challan
    expect(h.tripsThisMonth).toBeGreaterThanOrEqual(1);

    // Widening the setting brings the older one back.
    await sql`update companies set driver_history_days = 90 where id = ${t.companyId}`;
    expect((await dl.driverHistory(token))!.trips.map((x) => x.challanNo)).toContain(outside.no);

    // Paging: before the newest trip's date leaves only the older ones.
    const page = (await dl.driverHistory(token, h.trips[0].challanDate))!;
    expect(page.trips.map((x) => x.challanNo)).not.toContain(cancelled.no);

    // Read-only facts: no money anywhere.
    const json = JSON.stringify(h);
    expect(json).not.toMatch(/hire|freight|rate|margin|balance|advance|amount|paise|payable|tds/i);
    expect(json).not.toContain("76543");
  });

  it("a revoked or unknown link gets no history", async () => {
    const { t, driver, token } = await setup();
    await dl.revokeDriverLink(t.companyId, driver);
    signOut();
    expect(await dl.driverHistory(token)).toBeNull();
    expect(await dl.driverHistory("B".repeat(43))).toBeNull();
  });
});

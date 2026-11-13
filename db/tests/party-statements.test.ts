// Truck-owner statement links on the database (0024_party_statement_links.sql): the owner's link (resend =
// same URL, one active link per party, revoke / expiry), the session-less statement (revoked / expired
// gets nothing, party A never sees party B or another company), totals, and no freight / margin fields.
// Real lib/data functions.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/driver-link";
import { Fixtures, as, connect, pgError, type Sql } from "./helpers";

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
process.env.DRIVER_LINK_SECRET ??= "db-tests-driver-link-secret-0123456789abcdef";
process.env.APP_BASE_URL ??= "https://lr.test";

const session = await import("@/lib/data/session");
const ps = await import("@/lib/data/party-statements");
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
const signOut = () => jar.clear();

const tokenOf = (url: string) => url.split("/s/")[1];

/** India date `offset` days from today, ISO. */
const istDay = (offset = 0) =>
  new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);

/** Labels of the enum behind table.column (the migration tests don't hard-code enum values). */
async function enumLabels(table: string, column: string): Promise<string[]> {
  const rows = await sql`
    select e.enumlabel from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = (select udt_name from information_schema.columns
                         where table_schema = 'public' and table_name = ${table} and column_name = ${column})
     order by e.enumsortorder`;
  return rows.map((r) => r.enumlabel as string);
}

async function truckParty(companyId: string, name: string) {
  const [p] = await sql`insert into truck_parties (company_id, name) values (${companyId}, ${name}) returning id`;
  return p.id as string;
}

let branchId: Record<string, string> = {};
async function branch(companyId: string) {
  if (!branchId[companyId]) {
    const [b] = await sql`insert into branches (company_id, name) values (${companyId}, 'Stmt branch') returning id`;
    branchId[companyId] = b.id as string;
  }
  return branchId[companyId];
}

/** A dispatched challan paid to `party`, hire `hire`, dated `ageDays` ago. */
async function challan(companyId: string, party: string, hire: string, ageDays = 0) {
  const no = `CH-${crypto.randomUUID().slice(0, 6)}`;
  const at = new Date(Date.now() - ageDays * 86_400_000).toISOString();
  const [c] = await sql`
    insert into challans (company_id, challan_no, challan_fy, branch_id, rate, hire_amount, payee_party_id,
                          source, destination, challan_at)
    values (${companyId}, ${no}, '2026-27', ${await branch(companyId)}, ${hire}, ${hire}, ${party},
            'Patna', 'Kolkata', ${at})
    returning id`;
  await sql`update challans set status = 'dispatched', dispatched_at = ${at} where id = ${c.id}`;
  return { id: c.id as string, no };
}

/** A paid payment to `party` allocating `amount` (with `tds`) to one challan. */
async function paid(companyId: string, party: string, challanId: string, kind: "advance" | "balance", amount: string, tds = "0") {
  const mode = (await enumLabels("truck_payments", "mode")).find((m) => m !== "diesel" && m !== "cheque")!;
  const [p] = await sql`
    insert into truck_payments (company_id, branch_id, payment_no, payment_fy, paid_on, payee_party_id, mode,
                                amount, tds_amount, status, paid_at)
    values (${companyId}, ${await branch(companyId)}, ${`PV-${crypto.randomUUID().slice(0, 6)}`}, '2026-27',
            ${istDay()}, ${party}, ${mode}::truck_payment_mode, ${amount}, ${tds}, 'paid', now())
    returning id, payment_no`;
  await sql`insert into truck_payment_allocations (company_id, payment_id, challan_id, kind, amount, tds_amount)
            values (${companyId}, ${p.id}, ${challanId}, ${kind}, ${amount}, ${tds})`;
  return p.payment_no as string;
}

/** A truck-side charge (system POD lines are the only ones that need no charge-type master). */
async function charge(companyId: string, challanId: string, direction: "add" | "deduct", kindIdx: number, amount: string) {
  const kinds = await enumLabels("challan_charges", "auto_kind");
  await sql`
    insert into challan_charges (company_id, challan_id, stage, direction, amount, auto_kind, auto_amount)
    values (${companyId}, ${challanId}, 'pod', ${direction}::charge_direction, ${amount}, ${kinds[kindIdx]}::pod_auto_kind,
            ${amount})`;
}

/** v_challan_balance rows (money as 2-decimal text) for the given challans, read as `userId`. */
async function viewRows(userId: string, ids: string[]) {
  const rows = await as(sql, userId, (tx) => tx`
    select challan_id, hire_amount::text as hire_amount, additions::text as additions,
           deductions::text as deductions, tds_amount::text as tds_amount, paid::text as paid,
           balance::text as balance
      from v_challan_balance where challan_id = any(${ids}::uuid[])`);
  return new Map(rows.map((r) => [r.challan_id as string, r as Record<string, string>]));
}

/** Exact 2-decimal sum of money strings (integer paise, so no float drift). */
function sumMoney(vals: string[]): string {
  const paise = vals.reduce((n, v) => n + Math.round(Number(v) * 100), 0);
  return (paise / 100).toFixed(2);
}

/** A team, one truck party with a link. */
async function setup() {
  const t = await fx.team();
  signIn(t.owner, t.companyId);
  const party = await truckParty(t.companyId, "Owner A");
  const link = await ps.getOrCreatePartyStatementLink(t.companyId, party);
  return { t, party, link, token: tokenOf(link.url) };
}

describe("owner side: the party's link", () => {
  it("resend returns the same URL; max one active link; revoke kills it and a new one differs", async () => {
    const { t, party, link, token } = await setup();
    expect(link.url).toMatch(/^https:\/\/lr\.test\/s\/[A-Za-z0-9_-]{43}$/);
    const again = await ps.getOrCreatePartyStatementLink(t.companyId, party);
    expect(again.url).toBe(link.url);

    const rows = await sql`select token_hash, token_enc from share_links where party_id = ${party}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashToken(token));
    expect(rows[0].token_enc).not.toContain(token);

    // The database itself refuses a second active link for the party.
    const dup = await pgError(sql`
      insert into share_links (company_id, party_id, token_hash, token_enc, expires_at)
      values (${t.companyId}, ${party}, ${"0".repeat(64)}, 'v1.x', now() + interval '1 day')`);
    expect(dup.code).toBe("23505");

    expect((await ps.getPartyStatementLinkStatus(t.companyId, party))!.status).toBe("active");
    expect(await ps.revokePartyStatementLink(t.companyId, party)).toEqual({ revoked: true });
    expect(await ps.revokePartyStatementLink(t.companyId, party)).toEqual({ revoked: false });
    expect((await ps.getPartyStatementLinkStatus(t.companyId, party))!.status).toBe("revoked");
    signOut();
    expect(await ps.partyStatement(token)).toBeNull();
    signIn(t.owner, t.companyId);
    const fresh = await ps.getOrCreatePartyStatementLink(t.companyId, party);
    expect(fresh.url).not.toBe(link.url);

    const audit = await sql`select action from audit_log where company_id = ${t.companyId} and table_name = 'share_links'`;
    expect(audit.filter((a) => a.action === "create")).toHaveLength(2);
    expect(audit.some((a) => a.action === "update")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("needs master.edit to make / revoke: a driver login is refused; a party with no link has no status", async () => {
    const { t, party } = await setup();
    signIn(t.driver, t.companyId);
    await expect(ps.getOrCreatePartyStatementLink(t.companyId, party)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ps.revokePartyStatementLink(t.companyId, party)).rejects.toBeInstanceOf(ForbiddenError);
    signIn(t.owner, t.companyId);
    expect(await ps.getPartyStatementLinkStatus(t.companyId, await truckParty(t.companyId, "No link"))).toBeNull();
  });
});

describe("token side: revoked / expired", () => {
  it("an expired link gets nothing; the owner's next link replaces it", async () => {
    const { t, party, token } = await setup();
    signOut();
    const s = await ps.partyStatement(token);
    expect(s?.partyName).toBe("Owner A");
    expect(s?.companyName).toBeTruthy();
    const [{ last_opened_at }] = await sql`select last_opened_at from share_links where party_id = ${party}`;
    expect(last_opened_at).not.toBeNull();

    await sql`update share_links set expires_at = now() - interval '1 minute' where party_id = ${party}`;
    expect(await ps.partyStatement(token)).toBeNull();
    signIn(t.owner, t.companyId);
    expect((await ps.getPartyStatementLinkStatus(t.companyId, party))!.status).toBe("expired");
    const fresh = await ps.getOrCreatePartyStatementLink(t.companyId, party);
    expect(tokenOf(fresh.url)).not.toBe(token);
    const links = await sql`select revoked_at from share_links where party_id = ${party} order by created_at`;
    expect(links).toHaveLength(2);
    expect(links[0].revoked_at).not.toBeNull();
    expect(links[1].revoked_at).toBeNull();
  });

  it("a revoked or never-issued token gets nothing", async () => {
    const { t, party, token } = await setup();
    await ps.revokePartyStatementLink(t.companyId, party);
    signOut();
    expect(await ps.partyStatement(token)).toBeNull();
    expect(await ps.partyStatement("B".repeat(43))).toBeNull();
  });
});

describe("statement content", () => {
  it("party A never sees party B's or another company's data; totals match the raw rows", async () => {
    const { t, party, token } = await setup();
    const from = istDay(-30);
    const to = istDay(0);

    // A1 (in period): hire 10000.00 + 500.00 added − 200.00 deducted; 4000.00 advance + 3000.00 balance (TDS 30.00).
    const a1 = await challan(t.companyId, party, "10000.00", 1);
    await charge(t.companyId, a1.id, "add", 0, "500.00");
    await charge(t.companyId, a1.id, "deduct", 1, "200.00");
    const v1 = await paid(t.companyId, party, a1.id, "advance", "4000.00");
    const v2 = await paid(t.companyId, party, a1.id, "balance", "3000.00", "30.00");
    // A2 (before the period): hire 5000.50, unpaid.
    const a2 = await challan(t.companyId, party, "5000.50", 400);

    // Party B (same company) and another company's party: must never appear.
    const partyB = await truckParty(t.companyId, "Owner B");
    const b1 = await challan(t.companyId, partyB, "11111.11", 1);
    const vB = await paid(t.companyId, partyB, b1.id, "advance", "1111.00");
    const other = await fx.team();
    const otherParty = await truckParty(other.companyId, "Owner C");
    const o1 = await challan(other.companyId, otherParty, "22222.22", 1);

    signOut();
    const s = (await ps.partyStatement(token, from, to))!;
    expect(s.challans.map((c) => c.challanNo)).toEqual([a1.no]);
    // Money comes from v_challan_balance for the same challans (read as the owner, RLS on).
    const bal = await viewRows(t.owner, [a1.id, a2.id]);
    const v1row = bal.get(a1.id)!;
    expect(s.challans[0]).toMatchObject({
      hire: v1row.hire_amount,
      additions: v1row.additions,
      deductions: v1row.deductions,
      tds: v1row.tds_amount,
      paid: v1row.paid,
      balance: v1row.balance,
      status: "dispatched",
      podReceivedOn: null,
      vehicleNo: null,
      source: "Patna",
      destination: "Kolkata",
    });
    expect(s.payments.map((p) => p.voucherNo).sort()).toEqual([v1, v2].sort());
    const pv2 = s.payments.find((p) => p.voucherNo === v2)!;
    expect(pv2).toMatchObject({ gross: "3000.00", tds: "30.00", net: "2970.00", challans: [a1.no] });
    // Period totals = the view's values for the in-period challan (A1); outstanding = A1 + A2 over all time.
    expect(s.totals).toEqual({
      hire: v1row.hire_amount,
      additions: v1row.additions,
      deductions: v1row.deductions,
      tds: v1row.tds_amount,
      paid: v1row.paid,
      balance: v1row.balance,
    });
    const allTime = sumMoney([...bal.values()].map((r) => r.balance));
    expect(s.balanceOutstanding).toBe(allTime);

    const json = JSON.stringify(s);
    for (const foreign of [b1.no, vB, o1.no, "Owner B", "Owner C", "11111.11", "22222.22"]) {
      expect(json).not.toContain(foreign);
    }
    expect(json).not.toContain(a2.no); // outside the period

    // A wider period brings A2 in; its all-time balance is unchanged.
    const wide = (await ps.partyStatement(token, istDay(-500), to))!;
    expect(wide.challans.map((c) => c.challanNo).sort()).toEqual([a1.no, a2.no].sort());
    expect(wide.totals).toEqual({
      hire: sumMoney([...bal.values()].map((r) => r.hire_amount)),
      additions: sumMoney([...bal.values()].map((r) => r.additions)),
      deductions: sumMoney([...bal.values()].map((r) => r.deductions)),
      tds: sumMoney([...bal.values()].map((r) => r.tds_amount)),
      paid: sumMoney([...bal.values()].map((r) => r.paid)),
      balance: allTime,
    });
    expect(wide.balanceOutstanding).toBe(allTime);
  });

  it("a reversed / cancelled payment, a draft and a cancelled challan don't count", async () => {
    const { t, party, token } = await setup();
    const c1 = await challan(t.companyId, party, "1000.00", 1);
    const vOk = await paid(t.companyId, party, c1.id, "advance", "100.00");
    const draft = await challan(t.companyId, party, "999.00", 1);
    await sql`update challans set status = 'draft', dispatched_at = null where id = ${draft.id}`;
    const cancelled = await challan(t.companyId, party, "888.00", 1);
    await sql`update challans set cancelled_at = now(), cancel_reason = 'x' where id = ${cancelled.id}`;
    signOut();
    const s = (await ps.partyStatement(token, istDay(-5), istDay(0)))!;
    expect(s.challans.map((c) => c.challanNo)).toEqual([c1.no]);
    expect(s.payments.map((p) => p.voucherNo)).toEqual([vOk]);
    const bal = await viewRows(t.owner, [c1.id]);
    expect(s.balanceOutstanding).toBe(bal.get(c1.id)!.balance);
  });

  it("no freight, margin or consignor / consignee fields anywhere in the payload", async () => {
    const { t, party, token } = await setup();
    const lr = await fx.bookedLr(t.companyId);
    const c1 = await challan(t.companyId, party, "76543.21", 1);
    await sql`insert into challan_lrs (company_id, challan_id, lr_id, loaded_pkgs, freight_allocated)
              values (${t.companyId}, ${c1.id}, ${lr}, 10, 12345.67)`;
    await sql`update lrs set freight_paise = 1234567 where id = ${lr}`;
    signOut();
    const s = (await ps.partyStatement(token, istDay(-5), istDay(0)))!;
    expect(s.challans).toHaveLength(1);

    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          keys.push(k);
          walk(x);
        }
    };
    walk(s);
    expect(keys.filter((k) => /freight|margin|party_?amount|consign|profit/i.test(k))).toEqual([]);
    const json = JSON.stringify(s);
    expect(json).not.toContain("12345.67");
    expect(json).not.toContain("1234567");
  });

  it("the statement function isn't callable by signed-in users", async () => {
    const { t, token } = await setup();
    const direct = await pgError(
      as(sql, t.owner, (tx) => tx`
        select app.party_statement(${hashToken(token)}, ${istDay(-1)}::date, ${istDay()}::date)`),
    );
    expect(direct.code).toBe("42501");
  });
});

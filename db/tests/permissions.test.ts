// The database enforces the same rules as lib/permissions.ts.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { can, PERMISSIONS, ROLES, type Action } from "@/lib/permissions";
import { as, connect, Fixtures, pgError, type Sql } from "./helpers";

let sql: Sql;
let fx: Fixtures;

beforeAll(() => {
  sql = connect();
  fx = new Fixtures(sql);
});
afterEach(() => fx.cleanup());
afterAll(() => sql.end());

const ALL_ACTIONS = [...new Set(Object.values(PERMISSIONS).flat())] as Action[];

describe("role_permissions = lib/permissions.ts", () => {
  it("has exactly the PERMISSIONS map", async () => {
    const rows = await sql`select role::text, action from role_permissions order by role, action`;
    const fromDb = rows.map((r) => `${r.role}:${r.action}`).sort();
    const fromTs = Object.entries(PERMISSIONS)
      .flatMap(([role, actions]) => actions.map((a) => `${role}:${a}`))
      .sort();
    expect(fromDb).toEqual(fromTs);
  });

  it("app.can agrees with can() for every role and action", async () => {
    const t = await fx.team();
    const users = { owner: t.owner, accountant: t.accountant, booking_staff: t.staff, driver: t.driver };
    for (const role of ROLES) {
      const got = await as(sql, users[role], (tx) =>
        tx`select a as action, app.can(${t.companyId}, a) as ok from unnest(${ALL_ACTIONS}::text[]) a`,
      );
      for (const r of got) expect(r.ok, `${role} ${r.action}`).toBe(can(role, r.action as Action));
    }
  });
});

describe("writes follow the role", () => {
  it("LRs: booking staff may create, accountant may not", async () => {
    const t = await fx.team();
    const insertLr = (user: string, no: string) =>
      as(sql, user, (tx) => tx`insert into lrs (company_id, lr_no) values (${t.companyId}, ${no})`);
    await insertLr(t.staff, "S-1");
    expect((await pgError(insertLr(t.accountant, "A-1"))).code).toBe("42501");
    expect((await pgError(insertLr(t.driver, "D-1"))).code).toBe("42501");
  });

  it("freight bills: accountant may create, booking staff may not", async () => {
    const t = await fx.team();
    const party = await fx.party(t.companyId);
    const insertBill = (user: string) =>
      as(
        sql,
        user,
        (tx) => tx`insert into freight_bills (company_id, party_id, bill_date, gst_mode)
                   values (${t.companyId}, ${party}, '2026-10-27', 'reverse_charge')`,
      );
    await insertBill(t.accountant);
    expect((await pgError(insertBill(t.staff))).code).toBe("42501");
  });

  it("cancelling is owner-only (record.cancel)", async () => {
    const t = await fx.team();
    const party = await fx.party(t.companyId);
    const cancel = (user: string) =>
      as(sql, user, (tx) => tx`update parties set cancelled_at = now(), cancel_reason = 'dup' where id = ${party}`);
    for (const user of [t.staff, t.accountant]) {
      const e = await pgError(cancel(user));
      expect(e.code).toBe("42501");
      expect(e.message).toMatch(/record\.cancel/);
    }
    await cancel(t.owner);
    const [p] = await sql`select cancelled_at, cancel_reason, version, updated_by from parties where id = ${party}`;
    expect(p.cancelled_at).not.toBeNull();
    expect(p.updated_by).toBe(t.owner);
    expect(p.version).toBe(2);
    // and a cancelled record can't be changed or un-cancelled
    const e = await pgError(as(sql, t.owner, (tx) => tx`update parties set cancelled_at = null where id = ${party}`));
    expect(e.message).toMatch(/cancelled/);
  });

  it("booking staff can't cancel an LR; the owner can", async () => {
    const t = await fx.team();
    const lr = await fx.bookedLr(t.companyId);
    const cancel = (user: string) =>
      as(sql, user, (tx) => tx`update lrs set cancelled_at = now() where id = ${lr}`);
    expect((await pgError(cancel(t.staff))).code).toBe("42501");
    await cancel(t.owner);
  });

  it("import files can be removed by anyone with import.run (not record.cancel)", async () => {
    const t = await fx.team();
    const [b] = await as(
      sql,
      t.staff,
      (tx) => tx`insert into import_batches (company_id, source, file_name, format, kind, size_bytes)
                 values (${t.companyId}, 'excel', 'x.xlsx', 'xlsx', 'excel', 10) returning id, created_by`,
    );
    expect(b.created_by).toBe(t.staff);
    await as(sql, t.staff, (tx) => tx`update import_batches set cancelled_at = now() where id = ${b.id}`);
    const e = await pgError(
      as(sql, t.driver, (tx) => tx`insert into import_batches (company_id, source, file_name, format, kind, size_bytes)
                                  values (${t.companyId}, 'excel', 'y.xlsx', 'xlsx', 'excel', 10)`),
    );
    expect(e.code).toBe("42501");
  });

  it("users & roles: only company.manage changes memberships; the last owner stays", async () => {
    const t = await fx.team();
    const [m] = await sql`select id from memberships where user_id = ${t.staff} and company_id = ${t.companyId}`;
    const r = await as(sql, t.accountant, (tx) => tx`update memberships set role = 'owner' where id = ${m.id}`);
    expect(r.count).toBe(0);
    const [own] = await sql`select id from memberships where user_id = ${t.owner} and company_id = ${t.companyId}`;
    const e = await pgError(
      as(sql, t.owner, (tx) => tx`update memberships set role = 'accountant' where id = ${own.id}`),
    );
    expect(e.message).toMatch(/at least one owner/);
  });

  it("the self party can't be cancelled or edited from Parties, even by the owner", async () => {
    const t = await fx.team();
    const [self] = await sql`select id from parties where company_id = ${t.companyId} and is_self`;
    expect(
      (await pgError(as(sql, t.owner, (tx) => tx`update parties set cancelled_at = now() where id = ${self.id}`)))
        .message,
    ).toMatch(/own company/);
    expect(
      (await pgError(as(sql, t.owner, (tx) => tx`update parties set name = 'X' where id = ${self.id}`))).message,
    ).toMatch(/own company/);
    // Renaming the company renames its self party.
    await as(sql, t.owner, (tx) => tx`update companies set name = 'RENAMED CO' where id = ${t.companyId}`);
    const [after] = await sql`select name from parties where id = ${self.id}`;
    expect(after.name).toBe("RENAMED CO");
  });

  it("number series: each series needs its edit permission", async () => {
    const t = await fx.team();
    const take = (user: string, kind: string) =>
      as(sql, user, (tx) => tx`select * from app.allocate_number(${t.companyId}, ${kind}, '2026-27')`);
    await take(t.accountant, "freight_bill");
    expect((await pgError(take(t.accountant, "lr"))).code).toBe("42501");
    expect((await pgError(take(t.staff, "freight_bill"))).code).toBe("42501");
    const e = await pgError(
      as(sql, t.owner, (tx) => tx`update number_series set next_no = 1 where company_id = ${t.companyId}`),
    );
    expect(e.code).toBe("42501");
  });
});

describe("drivers and POD", () => {
  async function trips() {
    const t = await fx.team();
    const me = await fx.driver(t.companyId, "7870015869", t.driver);
    const other = await fx.driver(t.companyId, "8873764100");
    const myTruck = await fx.truck(t.companyId, "BR01GN8331", me);
    const otherTruck = await fx.truck(t.companyId, "BR06GB7374", other);
    const byMobile = await fx.bookedLr(t.companyId, { driverMobile: "7870015869" });
    const byTruck = await fx.bookedLr(t.companyId, { truckId: myTruck });
    const notMine = await fx.bookedLr(t.companyId, { driverMobile: "8873764100", truckId: otherTruck });
    return { ...t, byMobile, byTruck, notMine };
  }

  it("a driver reads no masters and no LRs directly, only their trips", async () => {
    const t = await trips();
    await as(sql, t.driver, async (tx) => {
      expect(await tx`select id from parties`).toHaveLength(0);
      expect(await tx`select id from lrs`).toHaveLength(0);
      const mine = await tx`select id from app.my_trips(${t.companyId})`;
      expect(mine.map((r) => r.id).sort()).toEqual([t.byMobile, t.byTruck].sort());
    });
  });

  it("a driver records POD and delivery on their own trips only", async () => {
    const t = await trips();
    const pod = (lr: string) =>
      as(sql, t.driver, async (tx) => {
        await tx`select app.set_lr_delivered(${t.companyId}, ${lr}, now())`;
        await tx`insert into pods (company_id, lr_id, received_at) values (${t.companyId}, ${lr}, now())`;
      });
    await pod(t.byMobile);
    await pod(t.byTruck);
    expect((await pgError(pod(t.notMine))).code).toBe("42501");
    const rows = await sql`select id, delivered_at is not null as delivered, pod_received_at is not null as pod
                             from lrs where company_id = ${t.companyId}`;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[t.byMobile]).toMatchObject({ delivered: true, pod: true });
    expect(byId[t.notMine]).toMatchObject({ delivered: false, pod: false });
  });

  it("without lr.edit you may only record delivery on an LR", async () => {
    const t = await trips();
    // Accountant: no lr.edit, no pod.upload → can't touch LRs at all.
    const r = await as(sql, t.accountant, (tx) => tx`update lrs set remarks = 'x' where id = ${t.byMobile}`);
    expect(r.count).toBe(0);
    // Owner: full edit.
    await as(sql, t.owner, (tx) => tx`update lrs set remarks = 'ok' where id = ${t.byMobile}`);
  });

  it("an accountant's payment marks the LR paid without lr.edit", async () => {
    const t = await trips();
    const party = await fx.party(t.companyId);
    const bill = await fx.finalBill(t.companyId, party, [t.notMine], 100_000);
    await as(sql, t.accountant, async (tx) => {
      const [p] = await tx`insert into payments (company_id, party_id, amount_paise, mode, received_on)
                           values (${t.companyId}, ${party}, 100000, 'neft_upi', '2026-11-05') returning id`;
      await tx`insert into payment_allocations (company_id, payment_id, freight_bill_id, amount_paise)
               values (${t.companyId}, ${p.id}, ${bill}, 100000)`;
    });
    const [lr] = await sql`select paid_at::text, billed_at::text, version from lrs where id = ${t.notMine}`;
    expect(lr).toEqual({ paid_at: "2026-11-05", billed_at: "2026-10-27", version: 1 });
  });
});

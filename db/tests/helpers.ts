// Fixtures for the DB integration tests. Connections go through the transaction pooler with
// prepare: false — the same way the app connects. Every company / user made here is tracked and
// purged in cleanup() (deletes are otherwise blocked by trigger).
import postgres from "postgres";
import type { Role } from "@/lib/types";
import { createSql } from "../client";

export type Sql = postgres.Sql;
export type TxSql = postgres.TransactionSql;

export function connect(max = 5): Sql {
  return createSql({ max });
}

/** Runs fn in one transaction as this user: role authenticated + JWT claims, so RLS applies. */
export async function as<T>(sql: Sql, userId: string, fn: (tx: TxSql) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  })) as T;
}

/** The Postgres error a promise rejects with (fails the test if it resolves). */
export async function pgError(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    const src = err.code ? err : (err.cause ?? err);
    return { code: src.code ?? "", message: src.message ?? String(e) };
  }
  throw new Error("Expected the query to fail, but it succeeded");
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A GSTIN-shaped value (no checksum) for state 10. */
export function fakeGstin(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const pick = () => letters[Math.floor(Math.random() * 26)];
  const digits = () => String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
  return `10${pick()}${pick()}${pick()}${pick()}${pick()}${digits()}${pick()}1Z${pick()}`;
}

export class Fixtures {
  private users: string[] = [];
  private companies: string[] = [];

  constructor(readonly sql: Sql) {}

  /** A Supabase Auth user (row in auth.users; public.users is made by trigger). */
  async user(name = "Test user"): Promise<string> {
    const id = crypto.randomUUID();
    await this.sql`
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
      values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`t-${id}@example.com`}, ${JSON.stringify({ name })}::jsonb, now(), now())`;
    this.users.push(id);
    return id;
  }

  /** New company through app.create_company, signed in as its owner. */
  async company(ownerId: string, label = `Test ${uniq()}`): Promise<string> {
    const [row] = await as(this.sql, ownerId, (tx) =>
      tx`select app.create_company(${label}, ${label.toUpperCase()}, 'Patna', ${fakeGstin()}, 'AAXFA2859G') as id`,
    );
    this.companies.push(row.id as string);
    return row.id as string;
  }

  /** A company inserted directly (no number series rows), owned by this user. */
  async bareCompany(ownerId: string): Promise<string> {
    const [c] = await this.sql`
      insert into companies (label, name, gstin, pan) values ('Bare', 'BARE', ${fakeGstin()}, 'AAXFA2859G')
      returning id`;
    this.companies.push(c.id as string);
    await this.member(c.id as string, ownerId, "owner");
    return c.id as string;
  }

  async member(companyId: string, userId: string, role: Role): Promise<string> {
    const [m] = await this.sql`
      insert into memberships (company_id, user_id, role) values (${companyId}, ${userId}, ${role})
      returning id`;
    return m.id as string;
  }

  /** Company + owner + one user per other role. */
  async team(): Promise<{
    companyId: string;
    owner: string;
    accountant: string;
    staff: string;
    driver: string;
  }> {
    const owner = await this.user("Owner");
    const companyId = await this.company(owner);
    const accountant = await this.user("Accountant");
    const staff = await this.user("Booking staff");
    const driver = await this.user("Driver");
    await this.member(companyId, accountant, "accountant");
    await this.member(companyId, staff, "booking_staff");
    await this.member(companyId, driver, "driver");
    return { companyId, owner, accountant, staff, driver };
  }

  async party(companyId: string, name = `Party ${uniq()}`, gstin: string | null = fakeGstin()) {
    const [p] = await this.sql`
      insert into parties (company_id, name, gstin, state_code) values (${companyId}, ${name}, ${gstin}, '10')
      returning id`;
    return p.id as string;
  }

  async driver(companyId: string, mobile: string, userId: string | null = null) {
    const [d] = await this.sql`
      insert into drivers (company_id, mobile, user_id) values (${companyId}, ${mobile}, ${userId})
      returning id`;
    return d.id as string;
  }

  async truck(companyId: string, number: string, driverId: string | null = null) {
    const [t] = await this.sql`
      insert into trucks (company_id, number, driver_id) values (${companyId}, ${number}, ${driverId})
      returning id`;
    return t.id as string;
  }

  /** A booked LR (lr_date + snapshot set). */
  async bookedLr(
    companyId: string,
    o: { lrNo?: string; consignorId?: string; driverMobile?: string | null; truckId?: string | null } = {},
  ): Promise<string> {
    const [l] = await this.sql`
      insert into lrs (company_id, lr_no, lr_date, consignor_id, driver_mobile, truck_id, payment_mode,
                       booked_at, snapshot)
      values (${companyId}, ${o.lrNo ?? uniq()}, '2026-10-14', ${o.consignorId ?? null},
              ${o.driverMobile ?? null}, ${o.truckId ?? null}, 'tbb', now(),
              ${JSON.stringify({ company: {}, consignor: null, consignee: null, billedTo: null })}::jsonb)
      returning id`;
    return l.id as string;
  }

  /** A final freight bill for these LRs (as the system; number fields filled directly). */
  async finalBill(companyId: string, partyId: string, lrIds: string[], amountPaise: number, billDate = "2026-10-27") {
    const [b] = await this.sql`
      insert into freight_bills (company_id, party_id, bill_date, gst_mode, status, amount_paise, charges_paise)
      values (${companyId}, ${partyId}, ${billDate}, 'reverse_charge', 'draft', ${amountPaise}, ${amountPaise})
      returning id`;
    let position = 0;
    for (const lrId of lrIds) {
      await this.sql`
        insert into freight_bill_lines (company_id, freight_bill_id, lr_id, position, freight_paise, total_paise)
        values (${companyId}, ${b.id}, ${lrId}, ${position++}, ${amountPaise}, ${amountPaise})`;
    }
    await this.sql`
      update freight_bills set status = 'final', bill_no = ${`FB-${uniq()}`},
             snapshot = ${JSON.stringify({ company: {}, party: {} })}::jsonb
       where id = ${b.id}`;
    return b.id as string;
  }

  /** Removes every company and user this fixture made. */
  async cleanup(): Promise<void> {
    const companies = this.companies.splice(0);
    const users = this.users.splice(0);
    if (!companies.length && !users.length) return;
    await this.sql.begin(async (tx) => {
      await tx`select set_config('app.purge', 'on', true)`;
      for (const c of companies) await tx`select app.purge_company(${c})`;
      // Rows in other tables pointing at these users (created_by etc.) are gone with the companies.
      if (users.length) await tx`delete from auth.users where id = any(${users}::uuid[])`;
    });
  }
}

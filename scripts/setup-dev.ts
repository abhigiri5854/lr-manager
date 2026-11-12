// pnpm db:setup-dev — baseline data for a fresh DEV database. Run AFTER pnpm db:migrate.
// Dev DB only: refuses when any DB URL or NEXT_PUBLIC_SUPABASE_URL is the production project
// (PROD_PROJECT_ID). Idempotent: a company that already exists (by login code) is left alone, so
// running it twice changes nothing. Passwords are generated and printed once, only for logins
// created in this run.
import { randomBytes } from "node:crypto";
import { createSql } from "../db/client";
import { assertNotProd, assertSupabaseUrlNotProd } from "../db/scripts/env-guard";

const FY = "2026-27";
const BUCKETS = ["logos", "signatures", "pod", "imports", "truck-docs"];

// Users are created through the Supabase Auth admin API; ids come from Auth (found by email on re-run).
const USERS = {
  owner: { email: "dev.owner@example.com", name: "Dev Owner", mobile: "9000000001" },
  staff: { email: "dev.staff@example.com", name: "Dev Booking Staff", mobile: "9000000002" },
  owner2: { email: "dev.owner2@example.com", name: "Dev Owner 2", mobile: "9000000003" },
} as const;

function authBase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (.env.local)");
  return {
    base: `${url.replace(/\/$/, "")}/auth/v1/admin`,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
  };
}

async function findAuthUserId(email: string): Promise<string | null> {
  const { base, headers } = authBase();
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${base}/users?page=${page}&per_page=200`, { headers });
    if (!res.ok) throw new Error(`Auth user list failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { users?: { id: string; email?: string }[] };
    const users = body.users ?? [];
    const hit = users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
  return null;
}

const VEHICLE_TYPES: [string, number][] = [
  ["Tata 407", 2500],
  ["14 ft", 4000],
  ["17 ft", 7000],
  ["19 ft", 9000],
  ["20 ft", 10000],
  ["22 ft", 12000],
  ["24 ft", 15000],
  ["32 ft SXL", 7000],
  ["32 ft MXL", 16000],
  ["10 wheel", 21000],
  ["12 wheel", 25000],
  ["14 wheel", 30000],
  ["Trailer 40 ft", 32000],
];

const CHARGE_TYPES = [
  { code: "DETENTION", label: "Detention", billColumn: "detention" },
  { code: "UNLOADING", label: "Unloading", billColumn: "unloading" },
] as const;

const created: { who: string; code: string; email: string; mobile: string; password: string }[] = [];

// Returns the Auth user id: existing user (found by email, password untouched) or a newly created one.
async function authUser(key: keyof typeof USERS, companyCode: string): Promise<string> {
  const u = USERS[key];
  const existing = await findAuthUserId(u.email);
  if (existing) return existing;
  const password = randomBytes(9).toString("base64url");
  const { base, headers } = authBase();
  const res = await fetch(`${base}/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: u.email,
      password,
      email_confirm: true,
      user_metadata: { name: u.name, mobile: u.mobile },
    }),
  });
  if (!res.ok) throw new Error(`Auth user create failed for ${u.email} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { id: string };
  created.push({ who: u.name, code: companyCode, email: u.email, mobile: u.mobile, password });
  return body.id;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production");
  assertNotProd("dev setup");
  assertSupabaseUrlNotProd("dev setup");

  const sql = createSql({ direct: true, max: 1 });
  try {
    // Storage buckets come from migrations 0004 / 0015: verify only.
    const have = new Set((await sql`select id from storage.buckets`).map((r) => r.id as string));
    const missing = BUCKETS.filter((b) => !have.has(b));
    if (missing.length) console.warn(`WARNING: storage bucket(s) missing: ${missing.join(", ")}. Did db:migrate run on this project?`);

    const exists = async (code: string) =>
      (await sql`select 1 from companies where code = ${code} and cancelled_at is null`).length > 0;

    // ── Dev Transport ──
    if (await exists("DEVTRN")) {
      console.log("Dev Transport already exists — skipped.");
    } else {
      const ownerId = await authUser("owner", "DEVTRN");
      const staffId = await authUser("staff", "DEVTRN");
      await sql.begin(async (tx) => {
        const [c] = await tx`
          select app.register_company(${ownerId}, 'DEVTRN', 'Dev Transport', 'Dev Transport',
                                      'Patna', '10ABCPS1234K1Z1', 'ABCPS1234K') as id`;
        const companyId = c.id as string;
        await tx`insert into memberships (company_id, user_id, role)
                 values (${companyId}, ${staffId}, 'booking_staff')`;
        await tx`update companies set office = 'Patna, Bihar',
                        late_pod_days = 15, late_pod_fee = 500,
                        maker_checker_limit = null, bank_change_cooling_hours = null, shortage_auto = false
                  where id = ${companyId}`;
        const [b] = await tx`insert into branches (company_id, name, code)
                             values (${companyId}, 'Patna', 'PAT') returning id`;
        await tx`insert into hire_number_series (company_id, doc_type, branch_id, fy, prefix, next_no, padding)
                 values (${companyId}, 'challan', ${b.id}, ${FY}, 'PAT/CH/26-27/', 1, 4),
                        (${companyId}, 'truck_payment', ${b.id}, ${FY}, 'PAT/PV/26-27/', 1, 4)`;
        for (const [name, kg] of VEHICLE_TYPES) {
          await tx`insert into vehicle_types (company_id, name, capacity_kg) values (${companyId}, ${name}, ${kg})`;
        }
        for (const t of CHARGE_TYPES) {
          await tx`insert into charge_types (company_id, code, label, default_direction, stage, active, bill_column)
                   values (${companyId}, ${t.code}, ${t.label}, 'add', 'pod', true, ${t.billColumn})`;
        }
      });
      console.log("Created Dev Transport (branch, series, vehicle types, charge types, hire settings).");
    }

    // ── Dev Company 2 (isolation tests): company + owner only ──
    if (await exists("DEVCO2")) {
      console.log("Dev Company 2 already exists — skipped.");
    } else {
      const owner2Id = await authUser("owner2", "DEVCO2");
      await sql`select app.register_company(${owner2Id}, 'DEVCO2', 'Dev Company 2', 'Dev Company 2',
                                            'Patna', '10AAAPD5678M1ZS', 'AAAPD5678M')`;
      console.log("Created Dev Company 2.");
    }
  } finally {
    await sql.end();
  }

  if (created.length) {
    console.log("\nLogins created now (shown once; log in with company code + mobile or e-mail):");
    for (const c of created) console.log(`  ${c.code}  ${c.who}  ${c.email}  ${c.mobile}  ${c.password}`);
  } else {
    console.log("\nNo new logins created (existing passwords are unchanged).");
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

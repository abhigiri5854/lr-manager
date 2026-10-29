// pnpm db:seed — loads the current sample data (lib/mock: ACM + RS, their parties, trucks, items,
// LRs, the goods invoice) into the database, with every sample user created as a Supabase Auth
// test user under the same id. Runs once; on a seeded database it does nothing (db:reset first).
import { eq } from "drizzle-orm";
import * as mock from "@/lib/mock";
import { ensureAuthUser } from "../auth-admin";
import { createDb, createSql } from "../client";
import {
  companyRow,
  driverRow,
  itemRow,
  lrRows,
  membershipRow,
  partyRow,
  taxInvoiceRows,
  truckRow,
  userRow,
} from "../rows";
import * as s from "../schema";

/** Login e-mail for a sample user (they have none in the mock, Supabase Auth needs one). */
export function seedEmail(u: { name: string; email: string | null }): string {
  return u.email ?? `seed.${u.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.com`;
}

const PREFIX_FIELD = {
  lr: "lrPrefix",
  freight_bill: "freightBillPrefix",
  tax_invoice: "taxInvoicePrefix",
} as const;

export async function seed(): Promise<"seeded" | "already"> {
  const sql = createSql({ direct: true, max: 1 });
  const db = createDb(sql);
  try {
    const acm = await db
      .select({ id: s.companies.id })
      .from(s.companies)
      .where(eq(s.companies.id, mock.IDS.company.acm));
    if (acm.length) return "already";

    // Supabase Auth test users, same ids as the sample data (password: MOCK_PASSWORD).
    for (const u of mock.mockUsers) {
      await ensureAuthUser({
        id: u.id,
        email: seedEmail(u),
        password: mock.MOCK_PASSWORD,
        name: u.name,
        mobile: u.mobile,
      });
    }

    const company = (id: string) => mock.mockCompanies.find((c) => c.id === id)!;
    await db.transaction(async (tx) => {
      for (const u of mock.mockUsers) {
        const row = { ...userRow(u), email: seedEmail(u) };
        await tx
          .insert(s.users)
          .values(row)
          .onConflictDoUpdate({
            target: s.users.id,
            set: { name: row.name, mobile: row.mobile, email: row.email },
          });
      }
      // Each company's self party is made by trigger, as for a new company.
      await tx.insert(s.companies).values(mock.mockCompanies.map(companyRow));
      await tx.insert(s.memberships).values(mock.mockMemberships.map(membershipRow));
      await tx.insert(s.parties).values(mock.mockParties.map(partyRow));
      await tx.insert(s.drivers).values(mock.mockDrivers.map(driverRow));
      await tx.insert(s.trucks).values(mock.mockTrucks.map(truckRow));
      await tx.insert(s.items).values(mock.mockItems.map(itemRow));
      await tx.insert(s.numberSeries).values(
        mock.mockNumberSeries.map((n) => ({
          companyId: n.companyId,
          series: n.series,
          fy: n.fy,
          prefix: company(n.companyId)[PREFIX_FIELD[n.series]],
          nextNo: n.nextValue,
        })),
      );
      for (const t of mock.mockTaxInvoices) {
        const { invoice, lines } = taxInvoiceRows(t, company(t.companyId));
        await tx.insert(s.taxInvoices).values(invoice);
        if (lines.length) await tx.insert(s.taxInvoiceLines).values(lines);
      }
      for (const lr of mock.mockLrs) {
        const rows = lrRows(lr, company(lr.companyId));
        await tx.insert(s.lrs).values(rows.lr);
        if (rows.items.length) await tx.insert(s.lrItems).values(rows.items);
        if (rows.invoices.length) await tx.insert(s.lrInvoices).values(rows.invoices);
      }
    });
    return "seeded";
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("db/scripts/seed.ts")) {
  seed()
    .then((r) =>
      console.log(
        r === "seeded"
          ? `Seeded ACM + RS and ${mock.mockUsers.length} Auth test users (password: the mock password).`
          : "Already seeded — run pnpm db:reset for a fresh copy.",
      ),
    )
    .catch((e: unknown) => {
      console.error("Seed failed:", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}

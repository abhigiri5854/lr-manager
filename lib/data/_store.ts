// In-memory stand-in for the database. The only file that imports lib/mock.
// Each helper mirrors what the Postgres version will do (company filter, version check,
// audit row, number series row lock) so swapping it out doesn't change any screen.
import type { z } from "zod";
import * as mock from "@/lib/mock";
import type {
  AuditEntry,
  BaseRecord,
  Company,
  Driver,
  FreightBill,
  ImportBatch,
  Item,
  Lr,
  Membership,
  Page,
  Payment,
  Party,
  Pod,
  TaxInvoice,
  Truck,
  User,
} from "@/lib/types";
import { selfPartyFields } from "@/lib/self-party";
import type { RuleError } from "@/lib/validators/common";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

type Store = {
  companies: Company[];
  users: User[];
  memberships: Membership[];
  parties: Party[];
  trucks: Truck[];
  drivers: Driver[];
  items: Item[];
  lrs: Lr[];
  taxInvoices: TaxInvoice[];
  pods: Pod[];
  freightBills: FreightBill[];
  payments: Payment[];
  importBatches: ImportBatch[];
  audit: AuditEntry[];
  numberSeries: mock.NumberSeriesRow[];
};

function seed(): Store {
  const store: Store = structuredClone({
    companies: mock.mockCompanies,
    users: mock.mockUsers,
    memberships: mock.mockMemberships,
    parties: mock.mockParties,
    trucks: mock.mockTrucks,
    drivers: mock.mockDrivers,
    items: mock.mockItems,
    lrs: mock.mockLrs,
    taxInvoices: mock.mockTaxInvoices,
    pods: [],
    freightBills: [],
    payments: [],
    importBatches: [],
    audit: [],
    numberSeries: mock.mockNumberSeries,
  });
  // Every company gets its "self" party, as it will when a company is created.
  for (const c of store.companies) {
    store.parties.push({
      id: crypto.randomUUID(),
      companyId: c.id,
      createdAt: c.createdAt,
      updatedAt: c.createdAt,
      version: 1,
      ...selfPartyFields(c),
      logoUrl: null,
      defaultFrom: null,
      defaultPaymentMode: null,
      defaultGstPayer: null,
      defaultChargedAs: null,
      source: "manual",
      isSelf: true,
    });
  }
  return store;
}

// Kept on globalThis so dev-server hot reloads don't wipe edits. Bump STORE_VERSION when the
// record shapes change so a running dev server reseeds instead of serving old-shaped rows.
const STORE_VERSION = 3; // 3: self party per company
const g = globalThis as typeof globalThis & {
  __lrManagerStore?: Store;
  __lrManagerStoreV?: number;
};
if (g.__lrManagerStoreV !== STORE_VERSION) {
  g.__lrManagerStore = seed();
  g.__lrManagerStoreV = STORE_VERSION;
}
export const db: Store = g.__lrManagerStore!;

/** Tests only: put the sample data back. */
export function resetStore(): void {
  Object.assign(db, seed());
}

/** Session defaults until auth exists (see session.ts). */
export const DEFAULT_SESSION = { companyId: mock.IDS.company.acm, userId: mock.IDS.user.owner };

// Audit rows are written as the session user until auth exists.
const currentUserId: string = DEFAULT_SESSION.userId;

export type TableName =
  | "companies"
  | "parties"
  | "trucks"
  | "drivers"
  | "items"
  | "lrs"
  | "tax_invoices"
  | "pods"
  | "freight_bills"
  | "payments";

// ---------- small utilities ----------
export const now = () => new Date().toISOString();
export const today = () => now().slice(0, 10);
export const newId = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);

/** Parse with Zod; failures become a ValidationError with field paths. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

export function assertRules(errors: RuleError[]): void {
  if (errors.length) throw new ValidationError(errors);
}

export function fail(path: string, message: string): never {
  throw new ValidationError([{ path, message }]);
}

// ---------- company-scoped reads ----------
type Scoped = { companyId: string; cancelledAt?: string };

export function scoped<T extends Scoped>(
  rows: T[],
  companyId: string,
  includeCancelled = false,
): T[] {
  return rows.filter((r) => r.companyId === companyId && (includeCancelled || !r.cancelledAt));
}

export function findById<T extends BaseRecord>(
  rows: T[],
  companyId: string,
  id: string,
): T | undefined {
  return rows.find((r) => r.id === id && r.companyId === companyId);
}

export function getOrThrow<T extends BaseRecord>(
  rows: T[],
  companyId: string,
  id: string,
  what: string,
): T {
  const row = findById(rows, companyId, id);
  if (!row) throw new NotFoundError(what);
  return row;
}

/** A referenced record must exist in this company and not be cancelled. Null refs are fine. */
export function assertRef(
  rows: BaseRecord[],
  companyId: string,
  id: string | null | undefined,
  path: string,
  what: string,
) {
  if (!id) return;
  const row = findById(rows, companyId, id);
  if (!row || row.cancelledAt) fail(path, `${what} not found in this company`);
}

// ---------- search & paging ----------
export type ListParams = { search?: string; page?: number; pageSize?: number };

export function matchesSearch(
  search: string | undefined,
  ...fields: Array<string | null | undefined>
): boolean {
  const q = search?.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

export function paginate<T>(rows: T[], params: ListParams): Page<T> {
  const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 50);
  const page = Math.max(params.page ?? 1, 1);
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total: rows.length, page, pageSize };
}

// ---------- writes (each writes audit_log) ----------
const SKIP_AUDIT = new Set(["updatedAt", "version"]);

export function writeAudit(
  companyId: string,
  table: TableName,
  recordId: string,
  action: AuditEntry["action"],
  before: object | null,
  after: object,
): void {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const changes = [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => !SKIP_AUDIT.has(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((field) => ({ field, old: b[field] ?? null, new: a[field] ?? null }));
  db.audit.push({
    id: newId(),
    companyId,
    createdAt: now(),
    userId: currentUserId,
    table,
    recordId,
    action,
    changes,
  });
}

export function insertRecord<T extends BaseRecord>(table: TableName, rows: T[], record: T): T {
  rows.push(record);
  writeAudit(record.companyId, table, record.id, "create", null, record);
  return clone(record);
}

/** Optimistic-locked update: fails with ConflictError when the version moved on. */
export function updateRecord<T extends BaseRecord>(
  table: TableName,
  rows: T[],
  companyId: string,
  id: string,
  expectedVersion: number,
  apply: (current: T) => T,
  what: string,
): T {
  const current = getOrThrow(rows, companyId, id, what);
  if (current.cancelledAt) fail("", `This ${what.toLowerCase()} is cancelled and can't be changed`);
  if (current.version !== expectedVersion) throw new ConflictError();
  const next: T = {
    ...apply(clone(current)),
    id: current.id,
    companyId: current.companyId,
    createdAt: current.createdAt,
    updatedAt: now(),
    version: current.version + 1,
  };
  rows[rows.indexOf(current)] = next;
  writeAudit(companyId, table, id, "update", current, next);
  return clone(next);
}

export function cancelRecord<T extends BaseRecord>(
  table: TableName,
  rows: T[],
  companyId: string,
  id: string,
  what: string,
  /** Extra fields saved with the cancel, e.g. the reason. */
  extra: Partial<T> = {},
): T {
  const current = getOrThrow(rows, companyId, id, what);
  if (current.cancelledAt) return clone(current);
  const at = now();
  const next: T = {
    ...current,
    ...extra,
    cancelledAt: at,
    updatedAt: at,
    version: current.version + 1,
  };
  rows[rows.indexOf(current)] = next;
  writeAudit(companyId, table, id, "cancel", current, next);
  return clone(next);
}

// ---------- number series ----------
export function findSeries(companyId: string, series: mock.NumberSeriesRow["series"], fy: string) {
  return db.numberSeries.find(
    (s) => s.companyId === companyId && s.series === series && s.fy === fy,
  );
}

/**
 * Takes the next number from the company + FY series. In Postgres this is
 * SELECT … FOR UPDATE on number_series inside the document's transaction — never max + 1.
 */
export function allocateNumber(
  companyId: string,
  series: mock.NumberSeriesRow["series"],
  fy: string,
): number {
  let row = findSeries(companyId, series, fy);
  if (!row) {
    if (series === "lr") {
      // LR numbers usually run on across years; carry on from the latest series.
      const latest = db.numberSeries
        .filter((s) => s.companyId === companyId && s.series === "lr")
        .sort((a, b) => b.fy.localeCompare(a.fy))[0];
      if (!latest) fail("lrNo", "Set the next LR number in Company profile first");
      row = { companyId, series, fy, nextValue: latest.nextValue };
    } else {
      row = { companyId, series, fy, nextValue: 1 };
    }
    db.numberSeries.push(row);
  }
  return row.nextValue++;
}

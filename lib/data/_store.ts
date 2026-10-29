// In-memory stand-in for the database. The only file that imports lib/mock.
// Each helper mirrors what the Postgres version will do (company filter, version check,
// audit row, number series row lock) so swapping it out doesn't change any screen.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import * as mock from "@/lib/mock";
import type {
  AuditEntry,
  BaseRecord,
  Company,
  Driver,
  FreightBill,
  ImportBatch,
  ImportMapping,
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
import { ConflictError, MockStoreError, NotFoundError, ValidationError } from "./errors";
import { onDatabase } from "./source";

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
  importMappings: ImportMapping[];
  audit: AuditEntry[];
  numberSeries: mock.NumberSeriesRow[];
  /** Mock logins (Supabase Auth later): salted scrypt hash per user. */
  credentials: Credential[];
};

type Credential = { userId: string; salt: string; hash: string };

/** Salted scrypt hash, as the mock stand-in for Supabase Auth. */
export function hashPassword(userId: string, password: string): Credential {
  const salt = randomBytes(16).toString("hex");
  return { userId, salt, hash: scryptSync(password, salt, 32).toString("hex") };
}

export function passwordMatches(c: Credential, password: string): boolean {
  const given = scryptSync(password, c.salt, 32);
  return timingSafeEqual(given, Buffer.from(c.hash, "hex"));
}

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
    importMappings: [],
    audit: [],
    numberSeries: mock.mockNumberSeries,
    credentials: [],
  });
  store.credentials = store.users.map((u) => hashPassword(u.id, mock.MOCK_PASSWORD));
  // Every company gets its "self" party, as it will when a company is created.
  for (const c of store.companies) {
    store.parties.push({
      id: crypto.randomUUID(),
      companyId: c.id,
      createdAt: c.createdAt,
      updatedAt: c.createdAt,
      version: 1,
      createdBy: null,
      updatedBy: null,
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
const STORE_VERSION = 7; // 7: createdBy/updatedBy, cached LR stamps
const g = globalThis as typeof globalThis & {
  __lrManagerStore?: Store;
  __lrManagerStoreV?: number;
};
if (g.__lrManagerStoreV !== STORE_VERSION) {
  g.__lrManagerStore = seed();
  g.__lrManagerStoreV = STORE_VERSION;
}
// Outside unit tests any read of the mock store is a bug: it fails instead of mixing sample and
// real data.
export const db: Store = new Proxy(g.__lrManagerStore!, {
  get(target, key, receiver) {
    if (onDatabase()) throw new MockStoreError();
    return Reflect.get(target, key, receiver);
  },
});

/** Tests only: put the sample data back. */
export function resetStore(): void {
  Object.assign(db, seed());
}

/** Sample company/user ids for tests and the first-login fallback. */
export const SAMPLE_IDS = { companyId: mock.IDS.company.acm, ownerId: mock.IDS.user.owner };

// Who audit rows are written as. lib/data/session.ts sets it whenever it reads the signed-in
// user, which every write does first (assertCan) — after that the write runs synchronously.
// In Postgres this is auth.uid() inside the transaction.
let auditActor: string | null = null;
export function setAuditActor(userId: string): void {
  auditActor = userId;
}

// Inside runAsSystem every audit row is written as "system" for that Smart import file, whatever
// the signed-in user is (getSessionUserId() keeps calling setAuditActor on every read).
let systemBatchId: string | null = null;
let batchContextId: string | null = null;

/** Who a new / changed record is stamped with (null = system). In Postgres: auth.uid() by trigger. */
function currentAuthor(): string | null {
  return systemBatchId ? null : auditActor;
}

/** createdBy / updatedBy for a new record. */
export function authorStamp(): { createdBy: string | null; updatedBy: string | null } {
  const by = currentAuthor();
  return { createdBy: by, updatedBy: by };
}

/** Runs `fn` with audit rows written as "system" + this batch id (bulk imports). */
export async function runAsSystem<T>(batchId: string, fn: () => Promise<T>): Promise<T> {
  const before = systemBatchId;
  systemBatchId = batchId;
  try {
    return await fn();
  } finally {
    systemBatchId = before;
  }
}

/** Runs `fn` with audit rows stamped with this batch id; the actor stays the signed-in user. */
export async function withBatchContext<T>(batchId: string, fn: () => Promise<T>): Promise<T> {
  const before = batchContextId;
  batchContextId = batchId;
  try {
    return await fn();
  } finally {
    batchContextId = before;
  }
}

/**
 * All-or-nothing: if `fn` throws, every change it made (records, audit rows, number series)
 * is undone. In Postgres this is one transaction around the whole import.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const snapshot = structuredClone({ ...db, credentials: [] as Credential[] });
  const credentials = db.credentials;
  try {
    return await fn();
  } catch (e) {
    Object.assign(db, snapshot, { credentials });
    throw e;
  }
}

export type TableName =
  | "companies"
  | "memberships"
  | "users"
  | "import_batches"
  | "import_mappings"
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
const SKIP_AUDIT = new Set(["updatedAt", "version", "updatedBy"]);

/** Field-level old → new diff, as stored in audit_log.changes (mock and database alike). */
export function auditChanges(before: object | null, after: object): AuditEntry["changes"] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => !SKIP_AUDIT.has(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((field) => ({ field, old: b[field] ?? null, new: a[field] ?? null }));
}

export function writeAudit(
  companyId: string,
  table: TableName,
  recordId: string,
  action: AuditEntry["action"],
  before: object | null,
  after: object,
): void {
  const changes = auditChanges(before, after);
  db.audit.push({
    id: newId(),
    companyId,
    createdAt: now(),
    userId: systemBatchId ? "system" : (auditActor ?? "system"),
    ...(systemBatchId || batchContextId ? { batchId: systemBatchId ?? batchContextId! } : {}),
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
    createdBy: current.createdBy,
    updatedBy: currentAuthor(),
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
    updatedBy: currentAuthor(),
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

type SeriesName = mock.NumberSeriesRow["series"];

function latestSeries(companyId: string, series: SeriesName) {
  return db.numberSeries
    .filter((s) => s.companyId === companyId && s.series === series)
    .sort((a, b) => b.fy.localeCompare(a.fy))[0];
}

/**
 * Whether a series starts again at 1 in a new financial year. LR numbers always run on;
 * freight bills and tax invoices follow the company's "reset each financial year" setting.
 */
function restartsEachYear(companyId: string, series: SeriesName): boolean {
  if (series === "lr") return false;
  return db.companies.find((c) => c.id === companyId)?.numberingResetsYearly ?? true;
}

/**
 * The value the next document in this FY would get, without taking it.
 * Null only for an LR series that was never set up.
 */
export function peekNumber(companyId: string, series: SeriesName, fy: string): number | null {
  const row = findSeries(companyId, series, fy);
  if (row) return row.nextValue;
  if (restartsEachYear(companyId, series)) return 1;
  return latestSeries(companyId, series)?.nextValue ?? (series === "lr" ? null : 1);
}

/**
 * Takes the next number from the company + FY series. In Postgres this is
 * SELECT … FOR UPDATE on number_series inside the document's transaction — never max + 1.
 */
export function allocateNumber(companyId: string, series: SeriesName, fy: string): number {
  let row = findSeries(companyId, series, fy);
  if (!row) {
    const start = peekNumber(companyId, series, fy);
    if (start === null) fail("lrNo", "Set the next LR number in Company profile first");
    row = { companyId, series, fy, nextValue: start };
    db.numberSeries.push(row);
  }
  return row.nextValue++;
}

/** Moves a series forward (Company profile). Never backwards: lower numbers may be in use. */
export function raiseNumber(
  companyId: string,
  series: SeriesName,
  fy: string,
  next: number,
  path: string,
): void {
  const current = peekNumber(companyId, series, fy);
  if (current !== null && next < current) {
    fail(path, `Can't go below ${current} — numbers up to ${current - 1} may already be used`);
  }
  const row = findSeries(companyId, series, fy);
  if (row) row.nextValue = next;
  else db.numberSeries.push({ companyId, series, fy, nextValue: next });
}

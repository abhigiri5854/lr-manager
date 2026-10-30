// Where Smart import keeps its files and looks things up. ./import.ts holds the rules and works
// only through ImportStore; the mock store (unit tests) is below, the database one is
// ./db/imports.ts.
//
// Lookups are synchronous (lib/import/excel-rows and invoice-prefill call them per row), so they
// are loaded up front: resolveLookups() runs the work once with a recorder that notes every key
// asked for, loads exactly those in one round trip, then runs the work again with the answers.
import type { Lookups } from "@/lib/import/excel-rows";
import { lookupFrom, type CorrectionRow } from "@/lib/import/corrections";
import type { PrefillLookups } from "@/lib/import/invoice-prefill";
import type { ImportCorrection } from "@/lib/import/types";
import type { PartyOption, TruckOption } from "@/lib/lr-form";
import type { ImportBatch, ImportMapping, Page, Party } from "@/lib/types";
import { normaliseVehicleNo } from "@/lib/validators/common";
import {
  authorStamp,
  cancelRecord,
  clone,
  db,
  findById,
  insertRecord,
  newId,
  now,
  paginate,
  runAsSystem,
  scoped,
  updateRecord,
  withBatchContext,
  withTransaction,
} from "./_store";

/** A tax invoice with this number from this seller (any status). */
export type ExistingInvoice = {
  id: string;
  version: number;
  status: "draft" | "final";
  cancelled: boolean;
  invoiceNo: string | null;
};

export type ImportLookups = Lookups &
  PrefillLookups & {
    existingInvoice(invoiceNo: string, sellerGstin: string | null): ExistingInvoice | null;
  };

/** The keys a piece of work asked for (see resolveLookups). */
export type ImportKeys = {
  lrNos: Set<string>;
  gstins: Set<string>;
  /** trimmed, lower case */
  names: Set<string>;
  /** normalised */
  trucks: Set<string>;
  invoiceNos: Set<string>;
  /** upper case */
  itemCodes: Set<string>;
  itemHsns: Set<string>;
  /** trimmed, lower case */
  itemNames: Set<string>;
  /** seller GSTINs whose remembered corrections are needed */
  sellerGstins: Set<string>;
};

export type HistoryBatch = ImportBatch & { byName: string | null };

export interface ImportStore {
  /** Reads that belong together (one database transaction, pipelined). */
  read<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * All-or-nothing work for one file. Audit rows carry the batch id; `system` = written as
   * "system" (Excel bulk import), else as the signed-in user.
   */
  importTx<T>(batch: ImportBatch, system: boolean, fn: () => Promise<T>): Promise<T>;
  getBatch(companyId: string, id: string): Promise<ImportBatch | null>;
  /** Live files not imported yet, newest first. */
  openBatches(companyId: string): Promise<ImportBatch[]>;
  /** Imported files and files that failed after being read, newest first. */
  history(companyId: string, params: { page?: number }): Promise<Page<HistoryBatch>>;
  insertBatch(batch: ImportBatch): Promise<ImportBatch>;
  /** Saves `next` over `current` (version-checked). */
  saveBatch(current: ImportBatch, next: ImportBatch): Promise<ImportBatch>;
  cancelBatch(companyId: string, id: string): Promise<void>;
  mappings(companyId: string): Promise<ImportMapping[]>;
  mappingById(companyId: string, id: string): Promise<ImportMapping | null>;
  /** Creates the mapping, or replaces the columns of the one with the same name. */
  upsertMapping(
    companyId: string,
    name: string,
    columns: Record<string, string>,
  ): Promise<ImportMapping>;
  lrPrefix(companyId: string): Promise<string>;
  lookups(companyId: string, lrPrefix: string, keys: ImportKeys): Promise<ImportLookups>;
  /** Seller memory: the seller's most recently seen corrections, newest first. */
  corrections(companyId: string, sellerGstin: string, limit: number): Promise<ImportCorrection[]>;
  /** Adds one to the count of each (field, wrong, correct), creating rows that are new. */
  recordCorrections(companyId: string, sellerGstin: string, rows: CorrectionRow[]): Promise<void>;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const toPartyOption = (p: Party): PartyOption => ({
  id: p.id,
  name: p.name,
  place: p.place,
  gstin: p.gstin,
  phone: p.phone,
  address: p.address,
  stateCode: p.stateCode,
  isSelf: p.isSelf,
});

function recorder(keys: ImportKeys, lrPrefix: string): ImportLookups {
  const note =
    <A extends unknown[]>(add: (...a: A) => void) =>
    (...a: A) => {
      add(...a);
      return null;
    };
  return {
    lrPrefix,
    lrByNo: note((n: string) => keys.lrNos.add(n)),
    partyByGstin: note((g: string) => keys.gstins.add(g)),
    partyByName: note((n: string) => keys.names.add(n.trim().toLowerCase())),
    truckByNumber: note((n: string) => keys.trucks.add(normaliseVehicleNo(n))),
    taxInvoice: note((no: string, g: string | null) => g && keys.invoiceNos.add(no)),
    existingInvoice: note((no: string, g: string | null) => g && keys.invoiceNos.add(no)),
    itemByCode: note((c: string) => keys.itemCodes.add(c.toUpperCase())),
    correction: note((g: string) => keys.sellerGstins.add(g)),
    itemByHsnOrName: note((hsn: string | null, d: string) => {
      if (hsn) keys.itemHsns.add(hsn);
      keys.itemNames.add(d.trim().toLowerCase());
    }),
  };
}

/** Runs `work` with every lookup it needs answered by one load (see the file comment). */
export async function resolveLookups<T>(
  store: ImportStore,
  companyId: string,
  work: (l: ImportLookups) => T,
  /** The company's LR prefix when the caller already read it. */
  lrPrefix?: string,
): Promise<T> {
  const prefix = lrPrefix ?? (await store.lrPrefix(companyId));
  const keys: ImportKeys = {
    lrNos: new Set(),
    gstins: new Set(),
    names: new Set(),
    trucks: new Set(),
    invoiceNos: new Set(),
    itemCodes: new Set(),
    itemHsns: new Set(),
    itemNames: new Set(),
    sellerGstins: new Set(),
  };
  work(recorder(keys, prefix));
  return work(await store.lookups(companyId, prefix, keys));
}

// ---------- the in-memory store (unit tests) ----------
const company = (companyId: string) => db.companies.find((c) => c.id === companyId)!;

/** Seller memory in unit tests (the database one is import_corrections). */
const mockCorrections: (ImportCorrection & { companyId: string; gstin: string })[] = [];

function mockLookups(companyId: string): ImportLookups {
  const prefix = company(companyId).lrPrefix;
  const sellerGstin = (partyId: string | null) =>
    partyId ? db.parties.find((p) => p.id === partyId)?.gstin : undefined;
  return {
    lrPrefix: prefix,
    lrByNo(lrNo) {
      const lr = db.lrs.find((l) => l.companyId === companyId && l.lrNo === `${prefix}${lrNo}`);
      if (!lr) return null;
      // Same status rule as lib/lr-status.ts, from what the LR carries.
      const billed = db.freightBills.some(
        (b) => b.companyId === companyId && !b.cancelledAt && b.lines.some((l) => l.lrId === lr.id),
      );
      const status = lr.cancelledAt ? "Cancelled" : billed ? "Billed" : "in the register";
      return { id: lr.id, status, updatable: !lr.cancelledAt && !billed };
    },
    partyByGstin: (gstin) => {
      const p = scoped(db.parties, companyId).find((x) => x.gstin === gstin);
      return p ? toPartyOption(p) : null;
    },
    partyByName: (name) => {
      const p = scoped(db.parties, companyId).find((x) => !x.isSelf && sameName(x.name, name));
      return p ? toPartyOption(p) : null;
    },
    truckByNumber: (number) => {
      const t = scoped(db.trucks, companyId).find((x) => x.number === normaliseVehicleNo(number));
      if (!t) return null;
      const driver = t.driverId ? db.drivers.find((d) => d.id === t.driverId) : null;
      return {
        id: t.id,
        number: t.number,
        driverMobile: driver?.mobile ?? null,
        lastLrNo: null,
      } satisfies TruckOption;
    },
    itemByCode: (code) => {
      const i = scoped(db.items, companyId).find((x) => x.code === code.toUpperCase());
      return i ? { id: i.id, hsn: i.hsn, uom: i.uom, gstRateBp: i.gstRateBp } : null;
    },
    correction: (gstin, field, wrong) =>
      lookupFrom(mockCorrections.filter((c) => c.companyId === companyId && c.gstin === gstin))(
        field,
        wrong,
      ),
    itemByHsnOrName: (hsn, description) => {
      const items = scoped(db.items, companyId);
      const i =
        items.find((x) => sameName(x.name, description)) ??
        (hsn ? items.find((x) => x.hsn === hsn) : undefined);
      return i ? { id: i.id, hsn: i.hsn, uom: i.uom, gstRateBp: i.gstRateBp } : null;
    },
    taxInvoice: (invoiceNo, gstin) => {
      if (!gstin) return null;
      const inv = scoped(db.taxInvoices, companyId).find(
        (i) => i.invoiceNo === invoiceNo && i.sellerPartyId !== null && sellerGstin(i.sellerPartyId) === gstin,
      );
      return inv ? { id: inv.id } : null;
    },
    existingInvoice: (invoiceNo, gstin) => {
      if (!gstin) return null;
      const i = scoped(db.taxInvoices, companyId, true).find(
        (x) => x.invoiceNo === invoiceNo && x.sellerPartyId !== null && sellerGstin(x.sellerPartyId) === gstin,
      );
      return i
        ? {
            id: i.id,
            version: i.version,
            status: i.status,
            cancelled: !!i.cancelledAt,
            invoiceNo: i.invoiceNo,
          }
        : null;
    },
  };
}

export const mockImportStore: ImportStore = {
  read: (fn) => fn(),
  importTx: (batch, system, fn) =>
    withTransaction(() => (system ? runAsSystem : withBatchContext)(batch.id, fn)),
  async getBatch(companyId, id) {
    const b = findById(db.importBatches, companyId, id);
    return b ? clone(b) : null;
  },
  async openBatches(companyId) {
    return scoped(db.importBatches, companyId)
      .filter((b) => b.status !== "imported")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  },
  async history(companyId, params) {
    const rows = scoped(db.importBatches, companyId)
      .filter((b) => b.status === "imported" || (b.status === "failed" && b.result !== null))
      .sort((a, b) => (b.importedAt ?? b.updatedAt).localeCompare(a.importedAt ?? a.updatedAt))
      .map((b) => ({
        ...clone(b),
        byName: db.users.find((u) => u.id === b.createdBy)?.name ?? null,
      }));
    return paginate(rows, params);
  },
  async insertBatch(batch) {
    return insertRecord("import_batches", db.importBatches, batch);
  },
  async saveBatch(current, next) {
    return updateRecord(
      "import_batches",
      db.importBatches,
      current.companyId,
      current.id,
      current.version,
      () => next,
      "Import file",
    );
  },
  async cancelBatch(companyId, id) {
    cancelRecord("import_batches", db.importBatches, companyId, id, "Import file");
  },
  async mappings(companyId) {
    return scoped(db.importMappings, companyId).map(clone);
  },
  async mappingById(companyId, id) {
    const m = findById(db.importMappings, companyId, id);
    return m && !m.cancelledAt ? clone(m) : null;
  },
  async upsertMapping(companyId, name, columns) {
    const existing = scoped(db.importMappings, companyId).find((m) => sameName(m.name, name));
    return existing
      ? updateRecord(
          "import_mappings",
          db.importMappings,
          companyId,
          existing.id,
          existing.version,
          (m) => ({ ...m, name, columns }),
          "Mapping",
        )
      : insertRecord("import_mappings", db.importMappings, {
          id: newId(),
          companyId,
          createdAt: now(),
          updatedAt: now(),
          version: 1,
          ...authorStamp(),
          name,
          columns,
        });
  },
  async lrPrefix(companyId) {
    return company(companyId).lrPrefix;
  },
  async lookups(companyId) {
    return mockLookups(companyId);
  },
  async corrections(companyId, gstin, limit) {
    return mockCorrections
      .filter((c) => c.companyId === companyId && c.gstin === gstin)
      .slice(-limit)
      .reverse();
  },
  async recordCorrections(companyId, gstin, rows) {
    for (const r of rows) {
      const hit = mockCorrections.find(
        (c) =>
          c.companyId === companyId &&
          c.gstin === gstin &&
          c.field === r.field &&
          c.wrong === r.wrong &&
          c.correct === r.correct,
      );
      if (hit) hit.count += 1;
      else mockCorrections.push({ ...r, companyId, gstin, count: 1 });
    }
  },
};

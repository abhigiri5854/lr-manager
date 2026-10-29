// Smart import: one ImportBatch per uploaded file, the review of what it contains, and the
// commit. The reader (lib/import/reader.ts) only turns a file into raw results; everything
// below works from those results, so swapping the mock reader changes nothing here.
//
// Excel booking sheet → "Import valid rows" runs in one transaction, audited as "system" with
// the batch id. Invoice files → the user reviews them in the Tax invoice form; saving there
// goes through saveImportedInvoice (one transaction too).
//
// Storage and lookups go through ImportStore (./import-store.ts): the database, or the sample
// data in unit tests.
import { formatDate } from "@/lib/format";
import { importableRows, reviewExcelRows, type ReviewRow } from "@/lib/import/excel-rows";
import { checkImportBytes, kindOf, type ImportSource } from "@/lib/import/file-types";
import { fieldLabel, isFieldKey } from "@/lib/import/fields";
import { invoicePrefill, type InvoicePrefill, type PendingRecords } from "@/lib/import/invoice-prefill";
import { detectedLabel, formatLabel, goesToLabel, type ChipTone } from "@/lib/import/labels";
import { getReader } from "@/lib/import/reader";
import {
  READ_SOURCE_LABEL,
  type DocumentReadResult,
  type ExcelReadResult,
  type ReadInvoice,
} from "@/lib/import/types";
import type { ImportBatch, ImportMapping, ImportRowAction, Page, TaxInvoice } from "@/lib/types";
import { gstinError, normaliseGstin } from "@/lib/validators/common";
import type { LrInput, LrPatch } from "@/lib/validators/lr";
import type { TaxInvoiceInput } from "@/lib/validators/invoice";
import { z } from "zod";
import { fail, newId, now, parseInput } from "./_store";
import { dbImportStore } from "./db/imports";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import {
  mockImportStore,
  resolveLookups,
  type ExistingInvoice,
  type ImportLookups,
  type ImportStore,
} from "./import-store";
import { createTaxInvoice, updateTaxInvoice } from "./invoices";
import { createImportedLr, getLrById, updateLr } from "./lrs";
import { createParty } from "./parties";
import { assertCan, getCurrentUserId } from "./session";
import { onDatabase } from "./source";
import { createTruck } from "./trucks";
import { uploadImportFile } from "./uploads";

const store = (): ImportStore => (onDatabase() ? dbImportStore : mockImportStore);

// ---------- permissions ----------
/** Everything on Smart import needs the import permission. */
async function assertImporter(companyId: string): Promise<void> {
  await assertCan(companyId, "import.run");
}

// ---------- looking things up ----------
async function getBatch(companyId: string, id: string): Promise<ImportBatch> {
  const b = await store().getBatch(companyId, id);
  if (!b) throw new NotFoundError("Import file");
  return b;
}

/** A live (not cancelled) batch, or null. */
async function liveBatch(companyId: string, id: string): Promise<ImportBatch | null> {
  const b = await store().getBatch(companyId, id);
  return b && !b.cancelledAt ? b : null;
}

function excelResult(b: ImportBatch): ExcelReadResult | null {
  return b.result?.kind === "excel" ? b.result : null;
}
function documentResult(b: ImportBatch): DocumentReadResult | null {
  return b.result?.kind === "document" ? b.result : null;
}

function reviewOf(l: ImportLookups, b: ImportBatch) {
  const result = excelResult(b);
  if (!result) return { rows: [] as ReviewRow[], counts: { valid: 0, warning: 0, error: 0 } };
  return reviewExcelRows(result, b.mapping, b.rowActions, l);
}

/** Columns still marked "Confirm" that the user hasn't answered. */
function columnsToConfirm(b: ImportBatch): string[] {
  const result = excelResult(b);
  if (!result) return [];
  return result.columns
    .filter((c) => c.confidence === "confirm" && !b.confirmedColumns.includes(c.header))
    .map((c) => c.header);
}

/** The tax invoice with this number from this seller (any status). */
const findExistingInvoice = (l: ImportLookups, inv: ReadInvoice): ExistingInvoice | null =>
  l.existingInvoice(inv.invoiceNo, inv.seller.gstin ?? null);

const isLocked = (e: ExistingInvoice | null) => !!e && (e.status === "final" || e.cancelled);

// ---------- creating a batch ----------
async function patchBatch(
  companyId: string,
  id: string,
  apply: (b: ImportBatch) => ImportBatch,
): Promise<ImportBatch> {
  const current = await getBatch(companyId, id);
  if (current.cancelledAt) fail("", "This import file is cancelled and can't be changed");
  return store().saveBatch(current, apply(current));
}

/**
 * Stores the uploaded file as a new batch and reads it (the reader is the mock one for now).
 * Excel booking reports need the "Create / edit LR" permission as well, because importing
 * them creates LRs; invoice files need "Tax invoices".
 */
export async function createImportBatch(
  companyId: string,
  input: { source: ImportSource; fileName: string; bytes: Uint8Array },
): Promise<ImportBatch> {
  await assertImporter(companyId);
  await assertCan(companyId, input.source === "excel" ? "lr.edit" : "invoice.edit");
  const checked = checkImportBytes({ name: input.fileName, bytes: input.bytes }, input.source);
  if (!checked.ok) fail("file", checked.message);
  const format = checked.format;
  const userId = await getCurrentUserId();
  const stored = await uploadImportFile(companyId, {
    name: input.fileName,
    format,
    bytes: input.bytes,
  });

  const t = now();
  const created = await store().insertBatch({
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    updatedBy: userId,
    source: input.source,
    fileName: stored.name,
    fileUrl: stored.url,
    format,
    kind: kindOf(format),
    mimeType: "",
    sizeBytes: input.bytes.byteLength,
    createdBy: userId,
    detectedAs: "unknown",
    status: "uploaded",
    error: null,
    result: null,
    mapping: {},
    confirmedColumns: [],
    mappingName: null,
    rowActions: {},
    counts: { valid: 0, warning: 0, error: 0 },
    createdRecords: [],
    importedAt: null,
  } satisfies ImportBatch);

  // Read it. A reader that throws leaves a "failed" file the user can remove.
  const file = { name: stored.name, type: "", bytes: input.bytes };
  try {
    if (input.source === "excel") {
      const mappings = await store().mappings(companyId);
      const result = await getReader().readExcel(file, {
        savedMappings: mappings.map((m) => m.columns),
      });
      const saved = coveringMapping(mappings, result);
      const suggested = Object.fromEntries(result.columns.map((c) => [c.header, c.suggestedField]));
      return store().saveBatch(created, {
        ...created,
        status: "read",
        detectedAs: "booking_report",
        result,
        mapping: saved ? { ...suggested, ...saved.columns } : suggested,
        confirmedColumns: saved ? result.columns.map((c) => c.header) : [],
        mappingName: saved?.name ?? null,
      });
    }
    const result = await getReader().readDocument(file);
    return store().saveBatch(created, {
      ...created,
      status: "read",
      detectedAs: result.documentType,
      result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't read this file";
    return store().saveBatch(created, { ...created, status: "failed", error: message });
  }
}

/** A saved mapping that names every column of the sheet is applied automatically. */
function coveringMapping(all: ImportMapping[], result: ExcelReadResult): ImportMapping | null {
  return all.find((m) => result.columns.every((c) => c.header in m.columns)) ?? null;
}

// ---------- the Files table and history ----------
export type FileAction =
  | { kind: "review"; label: string; href: string }
  | { kind: "open_invoice"; label: string; href: string }
  | { kind: "none" };

export type ImportFileRow = {
  id: string;
  fileName: string;
  sizeBytes: number;
  format: string;
  detected: string;
  /** What was found in the file, one line. */
  found: string;
  goesTo: string;
  chip: { tone: ChipTone; label: string };
  action: FileAction;
  /** Imported files stay in the history; the rest can be removed. */
  canRemove: boolean;
  selected: boolean;
  status: ImportBatch["status"];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function describe(l: ImportLookups, b: ImportBatch, selectedId: string | null): ImportFileRow {
  const base = {
    id: b.id,
    fileName: b.fileName,
    sizeBytes: b.sizeBytes,
    format: formatLabel(b),
    detected: detectedLabel(b),
    goesTo: goesToLabel(b),
    canRemove: b.status !== "imported",
    selected: b.id === selectedId,
    status: b.status,
  };
  const review = (label = "Review"): FileAction => ({
    kind: "review",
    label,
    href: `/import?batch=${b.id}`,
  });

  if (b.status === "failed") {
    return {
      ...base,
      found: b.error ?? "Couldn't read this file",
      chip: { tone: "red", label: "Failed" },
      action: b.result ? review("Review") : { kind: "none" },
    };
  }
  if (b.status === "uploaded" || !b.result) {
    return {
      ...base,
      found: "Reading…",
      chip: { tone: "grey", label: "Reading…" },
      action: { kind: "none" },
    };
  }
  if (b.status === "imported") {
    const inv = b.createdRecords.find((r) => r.table === "tax_invoices");
    return {
      ...base,
      found:
        b.result.kind === "excel"
          ? `${plural(b.createdRecords.filter((r) => r.table === "lrs").length, "LR")} created`
          : b.result.summary,
      chip: { tone: "green", label: "Imported" },
      action: inv
        ? { kind: "open_invoice", label: "Open invoice", href: `/invoices/${inv.id}` }
        : { kind: "none" },
    };
  }

  const excel = excelResult(b);
  if (excel) {
    const confirm = columnsToConfirm(b).length;
    const { counts } = reviewOf(l, b);
    return {
      ...base,
      found: `${excel.sheetName} · header on row ${excel.headerRow} · ${plural(excel.columns.length, "column")} · ${plural(excel.rows.length, "row")}`,
      chip:
        confirm > 0
          ? { tone: "amber", label: `${plural(confirm, "column")} to confirm` }
          : counts.error > 0
            ? { tone: "amber", label: `${plural(counts.error, "row")} with errors` }
            : { tone: "green", label: "Ready" },
      action: review(),
    };
  }

  const doc = documentResult(b)!;
  if (doc.documentType === "tax_invoice" && doc.invoice) {
    const existing = findExistingInvoice(l, doc.invoice);
    if (existing && isLocked(existing)) {
      return {
        ...base,
        found: doc.summary,
        chip: { tone: "grey", label: "Already exists" },
        action: {
          kind: "open_invoice",
          label: "Open in Tax invoice",
          href: `/invoices/${existing.id}`,
        },
      };
    }
    return {
      ...base,
      found: doc.summary,
      chip: { tone: "green", label: "Ready" },
      action: {
        kind: "open_invoice",
        label: "Open in Tax invoice",
        href: `/invoices/new?import=${b.id}`,
      },
    };
  }
  if (doc.documentType === "lr" && doc.lr) {
    const exists = l.lrByNo(String(Number(doc.lr.lrNo)));
    return {
      ...base,
      found: doc.summary,
      chip: exists
        ? { tone: "grey", label: "Already exists" }
        : { tone: "grey", label: "Not supported yet" },
      action: review(),
    };
  }
  return {
    ...base,
    found: doc.summary,
    chip: { tone: "grey", label: "Not supported yet" },
    action: review(),
  };
}

/** Files still being worked on, newest first. */
export async function listImportFiles(
  companyId: string,
  selectedId: string | null = null,
): Promise<ImportFileRow[]> {
  await assertImporter(companyId);
  const s = store();
  return s.read(async () => {
    const [batches, prefix] = await Promise.all([s.openBatches(companyId), s.lrPrefix(companyId)]);
    return resolveLookups(
      s,
      companyId,
      (l) => batches.map((b) => describe(l, b, selectedId)),
      prefix,
    );
  });
}

export type ImportHistoryRow = {
  id: string;
  date: string;
  fileName: string;
  by: string;
  counts: ImportBatch["counts"];
  created: number;
  status: "imported" | "failed";
  note: string | null;
};

/** Finished imports and imports that failed, newest first, 50 per page. */
export async function listImportHistory(
  companyId: string,
  params: { page?: number } = {},
): Promise<Page<ImportHistoryRow>> {
  await assertImporter(companyId);
  const page = await store().history(companyId, params);
  return {
    ...page,
    rows: page.rows.map((b) => ({
      id: b.id,
      date: formatDate((b.importedAt ?? b.updatedAt).slice(0, 10)),
      fileName: b.fileName,
      by: b.byName ?? "—",
      counts: b.counts,
      created: b.createdRecords.length,
      status: b.status === "imported" ? "imported" : "failed",
      note: b.status === "failed" ? b.error : null,
    })),
  };
}

/** Takes an unfinished file off the list (soft delete — the record stays for the audit trail). */
export async function removeImportBatch(companyId: string, id: string): Promise<void> {
  await assertImporter(companyId);
  const b = await getBatch(companyId, id);
  if (b.status === "imported") fail("", "This file has been imported — it stays in the history.");
  await store().cancelBatch(companyId, id);
}

// ---------- Excel: mapping ----------
export type ColumnView = {
  header: string;
  sample: string;
  field: string;
  fieldLabel: string;
  match: "sure" | "confirm" | "confirmed";
};

export type SavedInto = {
  lrNew: number;
  lrUpdate: number;
  lrSkipped: number;
  partiesNew: number;
  partiesMatched: number;
  trucksNew: number;
  invoicesLinked: number;
};

export type ReviewRowView = Omit<ReviewRow, "parsed">;

/** The review row without the parsed cells (the browser doesn't need them). */
function toView(r: ReviewRow): ReviewRowView {
  const view: Partial<ReviewRow> = { ...r };
  delete view.parsed;
  return view as ReviewRowView;
}

export type ExcelReviewView = {
  batchId: string;
  fileName: string;
  fileUrl: string | null;
  status: ImportBatch["status"];
  columns: ColumnView[];
  mappingName: string | null;
  savedMappings: { id: string; name: string }[];
  rows: ReviewRowView[];
  counts: ImportBatch["counts"];
  /** Rows "Import valid rows" would act on. */
  importable: number;
  savedInto: SavedInto;
  canImport: boolean;
};

function savedIntoOf(lookups: ImportLookups, rows: ReviewRow[]): SavedInto {
  const out: SavedInto = {
    lrNew: 0,
    lrUpdate: 0,
    lrSkipped: 0,
    partiesNew: 0,
    partiesMatched: 0,
    trucksNew: 0,
    invoicesLinked: 0,
  };
  const newParties = new Set<string>();
  const matched = new Set<string>();
  const newTrucks = new Set<string>();
  for (const r of rows) {
    if (r.action === "skip" || r.status === "error") {
      out.lrSkipped++;
      continue;
    }
    if (r.action === "update") out.lrUpdate++;
    else out.lrNew++;
    for (const p of [r.parsed.consignor, r.parsed.consignee]) {
      if (!p) continue;
      const key = p.gstin ?? `name:${p.name.toLowerCase()}`;
      const found =
        (p.gstin ? lookups.partyByGstin(p.gstin) : null) ??
        (p.name ? lookups.partyByName(p.name) : null);
      (found ? matched : newParties).add(key);
    }
    if (r.parsed.vehicleNo && !lookups.truckByNumber(r.parsed.vehicleNo))
      newTrucks.add(r.parsed.vehicleNo);
    if (
      r.parsed.invoiceNo &&
      lookups.taxInvoice(r.parsed.invoiceNo, r.parsed.consignor?.gstin ?? null)
    ) {
      out.invoicesLinked++;
    }
  }
  out.partiesNew = newParties.size;
  out.partiesMatched = matched.size;
  out.trucksNew = newTrucks.size;
  return out;
}

export async function getExcelReview(
  companyId: string,
  batchId: string,
): Promise<ExcelReviewView | null> {
  await assertImporter(companyId);
  const s = store();
  return s.read(async () => {
    const [b, mappings, prefix] = await Promise.all([
      liveBatch(companyId, batchId),
      s.mappings(companyId),
      s.lrPrefix(companyId),
    ]);
    const result = b ? excelResult(b) : null;
    if (!b || !result) return null;
    const { rows, counts, savedInto } = await resolveLookups(
      s,
      companyId,
      (l) => {
        const review = reviewOf(l, b);
        return { ...review, savedInto: savedIntoOf(l, review.rows) };
      },
      prefix,
    );
    const todo = importableRows(rows);
    const toConfirm = new Set(columnsToConfirm(b));
    return {
      batchId: b.id,
      fileName: b.fileName,
      fileUrl: b.fileUrl,
      status: b.status,
      columns: result.columns.map((c) => {
        const field = b.mapping[c.header] ?? c.suggestedField;
        return {
          header: c.header,
          sample: c.sample,
          field,
          fieldLabel: fieldLabel(field),
          match: c.confidence === "sure" ? "sure" : toConfirm.has(c.header) ? "confirm" : "confirmed",
        };
      }),
      mappingName: b.mappingName,
      savedMappings: mappings.map((m) => ({ id: m.id, name: m.name })),
      rows: rows.map(toView),
      counts,
      importable: todo.length,
      savedInto,
      canImport: b.status !== "imported" && b.status !== "uploaded" && todo.length > 0,
    };
  });
}

/** The user answered a column ("Confirm" → chosen field). Saved mapping name no longer applies. */
export async function setColumnMapping(
  companyId: string,
  batchId: string,
  header: string,
  field: string,
): Promise<void> {
  await assertImporter(companyId);
  if (!isFieldKey(field)) fail("field", "Choose where this column goes");
  const b = await getBatch(companyId, batchId);
  const result = excelResult(b);
  if (!result?.columns.some((c) => c.header === header))
    fail("header", "That column isn't in this file");
  if (b.status === "imported") fail("", "This file has already been imported");
  await patchBatch(companyId, batchId, (cur) => ({
    ...cur,
    status: "reviewed",
    mapping: { ...cur.mapping, [header]: field },
    confirmedColumns: [...new Set([...cur.confirmedColumns, header])],
    mappingName: null,
  }));
}

export async function setRowAction(
  companyId: string,
  batchId: string,
  rowNo: number,
  action: ImportRowAction,
): Promise<void> {
  await assertImporter(companyId);
  const b = await getBatch(companyId, batchId);
  if (b.status === "imported") fail("", "This file has already been imported");
  await patchBatch(companyId, batchId, (cur) => ({
    ...cur,
    status: "reviewed",
    rowActions: { ...cur.rowActions, [String(rowNo)]: action },
  }));
}

export async function listImportMappings(companyId: string): Promise<ImportMapping[]> {
  await assertImporter(companyId);
  return store().mappings(companyId);
}

const mappingName = z
  .string()
  .trim()
  .min(1, "Give the mapping a name")
  .max(60, "Keep the name under 60 characters");

/** "Save this mapping as …": remembers header → field for next time (same name = replace). */
export async function saveImportMapping(
  companyId: string,
  batchId: string,
  name: string,
): Promise<ImportMapping> {
  await assertImporter(companyId);
  const n = parseInput(mappingName, name);
  const b = await getBatch(companyId, batchId);
  if (!excelResult(b)) fail("", "Only Excel files have a column mapping");
  const saved = await store().upsertMapping(companyId, n, { ...b.mapping });
  await patchBatch(companyId, batchId, (cur) => ({
    ...cur,
    mappingName: saved.name,
    confirmedColumns: Object.keys(cur.mapping),
  }));
  return saved;
}

/** Uses a saved mapping on this file (columns it doesn't name keep the reader's guess). */
export async function applyImportMapping(
  companyId: string,
  batchId: string,
  mappingId: string,
): Promise<void> {
  await assertImporter(companyId);
  const [m, b] = await Promise.all([
    store().mappingById(companyId, mappingId),
    getBatch(companyId, batchId),
  ]);
  if (!m) throw new NotFoundError("Saved mapping");
  const result = excelResult(b);
  if (!result) fail("", "Only Excel files have a column mapping");
  if (b.status === "imported") fail("", "This file has already been imported");
  await patchBatch(companyId, batchId, (cur) => ({
    ...cur,
    status: "reviewed",
    mapping: {
      ...cur.mapping,
      ...Object.fromEntries(
        result.columns
          .filter((c) => c.header in m.columns)
          .map((c) => [c.header, m.columns[c.header]]),
      ),
    },
    confirmedColumns: result.columns.map((c) => c.header),
    mappingName: m.name,
  }));
}

// ---------- Excel: import valid rows ----------
export type CommitSummary = {
  lrsCreated: number;
  lrsUpdated: number;
  skipped: number;
  partiesCreated: number;
  trucksCreated: number;
};

function lrPatchFillingBlanks(
  lr: {
    items: {
      id: string;
      itemId: string | null;
      description: string;
      packages: number;
      actualWeight: string | null;
      chargedWeight: string | null;
      size: string | null;
    }[];
    truckId: string | null;
    driverMobile: string | null;
    ratePaise: number | null;
    charges: Record<string, number | null>;
    remarks: string | null;
  },
  p: ReviewRow["parsed"],
  truckId: string | null,
): LrPatch {
  const patch: LrPatch = {};
  if (!lr.truckId && truckId) patch.truckId = truckId;
  if (!lr.driverMobile && p.driverMobile) patch.driverMobile = p.driverMobile;
  if (lr.ratePaise == null && p.ratePaise != null) patch.ratePaise = p.ratePaise;
  if (!lr.charges.freight && p.freightPaise)
    patch.charges = { ...lr.charges, freight: p.freightPaise };
  if (!lr.remarks && p.remarks) patch.remarks = p.remarks;
  const hasGoods = p.packages != null || p.goods || p.billingWeight || p.actualWeight;
  if (lr.items.length === 0 && hasGoods) {
    patch.items = [
      {
        description: p.goods ?? "Goods",
        packages: p.packages ?? 0,
        actualWeight: p.actualWeight,
        chargedWeight: p.billingWeight,
      },
    ];
  } else if (lr.items.length > 0) {
    const first = lr.items[0];
    const next = {
      ...first,
      actualWeight: first.actualWeight ?? p.actualWeight,
      chargedWeight: first.chargedWeight ?? p.billingWeight,
    };
    if (next.actualWeight !== first.actualWeight || next.chargedWeight !== first.chargedWeight) {
      patch.items = lr.items.map((it, i) => (i === 0 ? next : it));
    }
  }
  return patch;
}

/**
 * "Import valid rows": creates the new LRs (drafts, with the sheet's LR numbers), their parties
 * and trucks, and fills the blanks of LRs the user chose to update. One transaction: if
 * anything fails nothing is saved and the file is marked failed. Audit rows say "system" and
 * carry the batch id; the created records are listed on the batch.
 */
export async function commitExcelBatch(companyId: string, batchId: string): Promise<CommitSummary> {
  await assertImporter(companyId);
  await assertCan(companyId, "lr.edit");
  const s = store();
  const batch = await getBatch(companyId, batchId);
  if (!excelResult(batch)) fail("", "This file isn't an Excel booking report");
  if (batch.status === "imported") fail("", "This file has already been imported");

  try {
    return await s.importTx(batch, true, async () => {
      const lrPrefix = await s.lrPrefix(companyId);
      const { lookups, rows, counts } = await resolveLookups(
        s,
        companyId,
        (l) => ({ lookups: l, ...reviewOf(l, batch) }),
        lrPrefix,
      );
      const todo = importableRows(rows);
      if (!todo.length) fail("", "Nothing to import — every row is skipped or has an error.");
      const created: ImportBatch["createdRecords"] = [];
      const partyIds = new Map<string, string>();
      const truckIds = new Map<string, string>();
      const summary: CommitSummary = {
        lrsCreated: 0,
        lrsUpdated: 0,
        skipped: rows.length - todo.length,
        partiesCreated: 0,
        trucksCreated: 0,
      };

      const partyFor = async (p: { name: string; gstin: string | null } | null) => {
        if (!p) return null;
        const key = p.gstin ?? `name:${p.name.toLowerCase()}`;
        const cached = partyIds.get(key);
        if (cached) return cached;
        const found =
          (p.gstin ? lookups.partyByGstin(p.gstin) : null) ??
          (p.name ? lookups.partyByName(p.name) : null);
        let id = found?.id;
        if (!id) {
          const party = await createParty(companyId, {
            name: p.name || p.gstin!,
            gstin: p.gstin ?? undefined,
            source: "excel_import",
          });
          id = party.id;
          created.push({ table: "parties", id });
          summary.partiesCreated++;
        }
        partyIds.set(key, id);
        return id;
      };
      const truckFor = async (number: string | null) => {
        if (!number) return null;
        const cached = truckIds.get(number);
        if (cached) return cached;
        let id = lookups.truckByNumber(number)?.id;
        if (!id) {
          const truck = await createTruck(companyId, { number, source: "excel_import" });
          id = truck.id;
          created.push({ table: "trucks", id });
          summary.trucksCreated++;
        }
        truckIds.set(number, id);
        return id;
      };

      for (const r of todo) {
        const p = r.parsed;
        try {
          const truckId = await truckFor(p.vehicleNo);
          if (r.action === "update" && r.existingLrId) {
            const lr = await getLrById(companyId, r.existingLrId);
            if (!lr) throw new NotFoundError("LR");
            const patch = lrPatchFillingBlanks(lr, p, truckId);
            if (Object.keys(patch).length) {
              await updateLr(companyId, lr.id, lr.version, patch);
              summary.lrsUpdated++;
            }
            continue;
          }
          const taxInvoiceId = p.invoiceNo
            ? lookups.taxInvoice(p.invoiceNo, p.consignor?.gstin ?? null)?.id
            : undefined;
          const hasGoods = p.packages != null || p.goods || p.billingWeight || p.actualWeight;
          const input: LrInput = {
            lrDate: p.lrDate,
            fromPlace: p.fromPlace,
            toPlace: p.toPlace,
            consignorId: await partyFor(p.consignor),
            consigneeId: await partyFor(p.consignee),
            truckId,
            driverMobile: p.driverMobile,
            ratePaise: p.ratePaise,
            lrInvoices: p.invoiceNo ? [{ invoiceNo: p.invoiceNo, taxInvoiceId }] : [],
            items: hasGoods
              ? [
                  {
                    description: p.goods ?? "Goods",
                    packages: p.packages ?? 0,
                    actualWeight: p.actualWeight,
                    chargedWeight: p.billingWeight,
                  },
                ]
              : [],
            charges: { freight: p.freightPaise },
            remarks: p.remarks,
          };
          const lr = await createImportedLr(companyId, input, p.lrNo!, batchId, lrPrefix);
          created.push({ table: "lrs", id: lr.id });
          summary.lrsCreated++;
        } catch (e) {
          // Name the row, so the message tells the user what to fix.
          if (e instanceof ValidationError) {
            throw new ValidationError([
              { path: "", message: `Excel row ${r.rowNo}: ${e.message}` },
            ]);
          }
          throw e;
        }
      }

      await patchBatch(companyId, batchId, (b) => ({
        ...b,
        status: "imported",
        counts,
        createdRecords: created,
        importedAt: now(),
        error: null,
      }));
      return summary;
    });
  } catch (e) {
    // Everything was rolled back; just remember why on the file.
    const message = e instanceof Error ? e.message : "The import failed";
    const nothingToDo = e instanceof ValidationError && message.startsWith("Nothing to import");
    if (!(e instanceof ForbiddenError) && !nothingToDo) {
      await patchBatch(companyId, batchId, (b) => ({ ...b, status: "failed", error: message }));
    }
    throw e;
  }
}

// ---------- Excel: error report ----------
export type ErrorReport = {
  fileName: string;
  headers: string[];
  rows: { rowNo: number; record: string; reason: string; cells: string[] }[];
};

export async function errorReportRows(
  companyId: string,
  batchId: string,
): Promise<ErrorReport | null> {
  await assertImporter(companyId);
  const s = store();
  return s.read(async () => {
    const [b, prefix] = await Promise.all([liveBatch(companyId, batchId), s.lrPrefix(companyId)]);
    const result = b ? excelResult(b) : null;
    if (!b || !result) return null;
    const { rows } = await resolveLookups(s, companyId, (l) => reviewOf(l, b), prefix);
    const headers = result.columns.map((c) => c.header);
    const byRow = new Map(result.rows.map((r) => [r.rowNo, r.cells]));
    return {
      fileName: b.fileName,
      headers,
      rows: rows
        .filter((r) => r.status === "error")
        .map((r) => ({
          rowNo: r.rowNo,
          record: r.record,
          reason: r.reasons.join("; "),
          cells: headers.map((h) => byRow.get(r.rowNo)?.[h] ?? ""),
        })),
    };
  });
}

// ---------- invoices and other documents ----------
export type InvoiceImportView = {
  batch: {
    id: string;
    fileName: string;
    fileUrl: string | null;
    format: ImportBatch["format"];
    sizeBytes: number;
    /** Labels of the readers that supplied the fields, e.g. ["QR", "PDF text"]. Empty for the mock reader. */
    readBy: string[];
  };
  prefill: InvoicePrefill;
  /** An invoice with this number from this seller already exists. */
  existing: {
    id: string;
    version: number;
    status: "draft" | "final" | "cancelled";
    invoiceNo: string | null;
  } | null;
};

/** What /invoices/new?import=<batch> opens with. Creates nothing. */
export async function getInvoiceImport(
  companyId: string,
  batchId: string,
): Promise<InvoiceImportView | null> {
  await assertImporter(companyId);
  await assertCan(companyId, "invoice.edit");
  const s = store();
  return s.read(async () => {
    const [b, prefix] = await Promise.all([liveBatch(companyId, batchId), s.lrPrefix(companyId)]);
    const doc = b ? documentResult(b) : null;
    if (!b || !doc || doc.documentType !== "tax_invoice" || !doc.invoice) return null;
    if (b.status === "imported" || b.status === "failed") return null;
    const inv = doc.invoice;
    const { prefill, existing } = await resolveLookups(
      s,
      companyId,
      (l) => ({
        prefill: invoicePrefill(inv, doc.lowConfidence, l),
        existing: findExistingInvoice(l, inv),
      }),
      prefix,
    );
    return {
      batch: {
        id: b.id,
        fileName: b.fileName,
        fileUrl: b.fileUrl,
        format: b.format,
        sizeBytes: b.sizeBytes,
        readBy: (doc.readBy ?? []).map((r) => READ_SOURCE_LABEL[r]),
      },
      prefill,
      existing: existing
        ? {
            id: existing.id,
            version: existing.version,
            status: existing.cancelled ? "cancelled" : existing.status,
            invoiceNo: existing.invoiceNo,
          }
        : null,
    };
  });
}

/** One row of the review table for a non-Excel file (the whole document is one record). */
export type DocumentReviewView = {
  batchId: string;
  fileName: string;
  fileUrl: string | null;
  source: string;
  record: string;
  status: "valid" | "warning" | "error";
  checks: string[];
  reasons: string[];
  /** Where the action leads, or why there is none. */
  openHref: string | null;
  openLabel: string | null;
  note: string | null;
};

export async function getDocumentReview(
  companyId: string,
  batchId: string,
): Promise<DocumentReviewView | null> {
  await assertImporter(companyId);
  const s = store();
  return s.read(async () => {
    const [b, prefix] = await Promise.all([liveBatch(companyId, batchId), s.lrPrefix(companyId)]);
    const doc = b ? documentResult(b) : null;
    if (!b || !doc) return null;
    return resolveLookups(s, companyId, (l) => documentReview(l, b, doc), prefix);
  });
}

function documentReview(
  l: ImportLookups,
  b: ImportBatch,
  doc: DocumentReadResult,
): DocumentReviewView {
  const how = b.kind === "image" ? "photo" : b.kind === "pdf" ? "PDF" : "file";
  const base = {
    batchId: b.id,
    fileName: b.fileName,
    fileUrl: b.fileUrl,
    source: `invoice ${how}`,
  };
  if (doc.documentType === "tax_invoice" && doc.invoice) {
    const inv = doc.invoice;
    const checks: string[] = [];
    const reasons: string[] = [];
    for (const [label, p] of [
      ["Seller", inv.seller],
      ["Buyer", inv.billTo],
    ] as const) {
      if (!p.gstin) continue;
      const err = gstinError(normaliseGstin(p.gstin));
      if (err) reasons.push(`${label} ${err}`);
    }
    if (!reasons.length) checks.push("GSTIN valid");
    checks.push(`${plural(inv.lines.length, "item")} read`);
    const existing = findExistingInvoice(l, inv);
    if (existing) {
      reasons.push(
        existing.cancelled
          ? `${inv.invoiceNo} is already in the system (cancelled)`
          : existing.status === "final"
            ? `${inv.invoiceNo} is already in the system (final) — it can't be changed`
            : `${inv.invoiceNo} is already in the system as a draft — saving updates it`,
      );
    }
    const locked = isLocked(existing);
    return {
      ...base,
      record: `${inv.invoiceNo} · ${inv.billTo.name}`,
      status:
        reasons.some((r) => /GSTIN/.test(r)) || locked
          ? "error"
          : reasons.length
            ? "warning"
            : "valid",
      checks,
      reasons,
      openHref: locked ? `/invoices/${existing!.id}` : `/invoices/new?import=${b.id}`,
      openLabel: "Open in Tax invoice",
      note: null,
    };
  }
  if (doc.documentType === "lr" && doc.lr) {
    const exists = l.lrByNo(String(Number(doc.lr.lrNo)));
    return {
      ...base,
      source: `LR ${how}`,
      record: `LR ${doc.lr.lrNo} · ${doc.lr.consignor} → ${doc.lr.consignee}`,
      status: exists ? "warning" : "valid",
      checks: [],
      reasons: exists ? ["Same LR no. already in system"] : [],
      openHref: exists ? `/lr/${exists.id}` : null,
      openLabel: exists ? `Open LR ${doc.lr.lrNo}` : null,
      note: exists
        ? "Skipped — nothing to import from this file."
        : "Reading consignment notes into the LR form comes with the real reader.",
    };
  }
  return {
    ...base,
    record: doc.summary,
    status: "warning",
    checks: [],
    reasons: ["This kind of document can't be imported yet"],
    openHref: null,
    openLabel: null,
    note: null,
  };
}

/**
 * Saves the invoice the user reviewed in the Tax invoice form: creates the parties and truck
 * that were new on the invoice, then the draft (or updates the existing draft with the same
 * number), links it to the file and marks the file imported — all or nothing.
 */
export async function saveImportedInvoice(
  companyId: string,
  args: {
    batchId: string;
    input: TaxInvoiceInput;
    pending: PendingRecords;
    update?: { id: string; expectedVersion: number } | null;
  },
): Promise<TaxInvoice> {
  await assertImporter(companyId);
  await assertCan(companyId, "invoice.edit");
  const batch = await getBatch(companyId, args.batchId);
  if (!documentResult(batch)) fail("", "This file isn't an invoice");
  if (batch.status === "imported") fail("", "This invoice file has already been saved");

  return store().importTx(batch, false, async () => {
    const created: ImportBatch["createdRecords"] = [];
    const ids = new Map<string, string>();
    const swap = (id: unknown) => (typeof id === "string" ? (ids.get(id) ?? id) : id);
    // Only records the invoice really points at get created.
    const used = new Set(
      [
        args.input.sellerPartyId,
        args.input.billToId,
        args.input.shipToId,
        args.input.truckId,
      ].filter((x): x is string => typeof x === "string"),
    );
    for (const [token, party] of Object.entries(args.pending.parties)) {
      if (!used.has(token)) continue;
      const p = await createParty(companyId, party);
      ids.set(token, p.id);
      created.push({ table: "parties", id: p.id });
    }
    for (const [token, truck] of Object.entries(args.pending.trucks)) {
      if (!used.has(token)) continue;
      const t = await createTruck(companyId, { number: truck.number, source: "invoice_scan" });
      ids.set(token, t.id);
      created.push({ table: "trucks", id: t.id });
    }
    const input = {
      ...args.input,
      sellerPartyId: swap(args.input.sellerPartyId),
      billToId: swap(args.input.billToId),
      shipToId: swap(args.input.shipToId),
      truckId: swap(args.input.truckId),
      importBatchId: batch.id,
      sourceFileUrl: batch.fileUrl,
    } as TaxInvoiceInput;
    const invoice = args.update
      ? await updateTaxInvoice(companyId, args.update.id, args.update.expectedVersion, input)
      : await createTaxInvoice(companyId, input);
    created.unshift({ table: "tax_invoices", id: invoice.id });
    await patchBatch(companyId, batch.id, (b) => ({
      ...b,
      status: "imported",
      counts: { valid: 1, warning: 0, error: 0 },
      createdRecords: created,
      importedAt: now(),
      error: null,
    }));
    return invoice;
  });
}

// ---------- after an import ----------
export type ImportResultView = {
  batchId: string;
  fileName: string;
  lrs: number;
  parties: number;
  trucks: number;
  invoices: number;
  /** Rows that had errors and were left out (Excel). */
  errorRows: number;
};

/** What a finished import created, for the "Imported …" notice. */
export async function getImportResult(
  companyId: string,
  batchId: string,
): Promise<ImportResultView | null> {
  await assertImporter(companyId);
  const b = await liveBatch(companyId, batchId);
  if (!b || b.status !== "imported") return null;
  const count = (table: string) => b.createdRecords.filter((r) => r.table === table).length;
  return {
    batchId: b.id,
    fileName: b.fileName,
    lrs: count("lrs"),
    parties: count("parties"),
    trucks: count("trucks"),
    invoices: count("tax_invoices"),
    errorRows: b.counts.error,
  };
}

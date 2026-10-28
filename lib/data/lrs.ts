import { financialYear } from "@/lib/fy";
import { normaliseVehicleNo } from "@/lib/validators/common";
import { companySnapshot, partySnapshot } from "@/lib/snapshots";
import type {
  ChargedAs,
  GstPayer,
  Lr,
  LrCharges,
  LrPaymentMode,
  LrStatus,
  LrView,
  Page,
} from "@/lib/types";
import {
  lrBookingErrors,
  lrCancelSchema,
  lrFields,
  lrPatchSchema,
  type LrCancelInput,
  type LrInput,
  type LrPatch,
} from "@/lib/validators/lr";
import { billForLr, toLrView } from "./_derive";
import {
  allocateNumber,
  assertRef,
  assertRules,
  cancelRecord,
  db,
  fail,
  findById,
  peekNumber,
  insertRecord,
  matchesSearch,
  newId,
  now,
  paginate,
  parseInput,
  raiseNumber,
  scoped,
  today,
  updateRecord,
  type ListParams,
} from "./_store";
import { assertCan } from "./session";

export type LrListParams = ListParams & {
  partyId?: string;
  truckId?: string;
  status?: LrStatus;
  /** Inclusive, yyyy-mm-dd, on LR date. */
  dateFrom?: string;
  dateTo?: string;
};

const EMPTY_CHARGES: LrCharges = {
  freight: null,
  packing: null,
  cnCharge: null,
  loading: null,
  unloading: null,
  detention: null,
  other: null,
  gst: null,
  advance: null,
};

type ParsedLr = ReturnType<typeof lrFields.parse>;
type ParsedPatch = ReturnType<typeof lrPatchSchema.parse>;

/** Every id an LR points at must belong to this company. */
function assertLrRefs(companyId: string, v: ParsedPatch) {
  assertRef(db.parties, companyId, v.consignorId, "consignorId", "Consignor");
  assertRef(db.parties, companyId, v.consigneeId, "consigneeId", "Consignee");
  assertRef(db.parties, companyId, v.billedToId, "billedToId", "Billed-to party");
  assertRef(db.trucks, companyId, v.truckId, "truckId", "Truck");
  v.lrInvoices?.forEach((inv, i) =>
    assertRef(
      db.taxInvoices,
      companyId,
      inv.taxInvoiceId,
      `lrInvoices.${i}.taxInvoiceId`,
      "Tax invoice",
    ),
  );
  v.items?.forEach((item, i) =>
    assertRef(db.items, companyId, item.itemId, `items.${i}.itemId`, "Item"),
  );
}

/** Fill ids and nulls on nested rows. */
function normaliseNested(v: Pick<ParsedLr, "items" | "lrInvoices">) {
  return {
    items: v.items?.map((i) => ({
      id: i.id ?? newId(),
      itemId: i.itemId ?? null,
      description: i.description,
      packages: i.packages,
      actualWeight: i.actualWeight ?? null,
      chargedWeight: i.chargedWeight ?? null,
      size: i.size ?? null,
    })),
    lrInvoices: v.lrInvoices?.map((i) => ({
      id: i.id ?? newId(),
      invoiceNo: i.invoiceNo,
      invoiceDate: i.invoiceDate ?? null,
      valuePaise: i.valuePaise ?? null,
      ewayBillNo: i.ewayBillNo ?? null,
      ewayExpiresAt: i.ewayExpiresAt ?? null,
      taxInvoiceId: i.taxInvoiceId ?? null,
    })),
  };
}

function snapshotFor(lr: Lr): Lr["snapshot"] {
  const company = db.companies.find((c) => c.id === lr.companyId)!;
  const party = (id: string | null) => {
    const p = id ? db.parties.find((x) => x.id === id) : undefined;
    return p ? partySnapshot(p) : null;
  };
  return {
    company: companySnapshot(company),
    consignor: party(lr.consignorId),
    consignee: party(lr.consigneeId),
    billedTo: party(lr.billedToId),
  };
}

function assertNotOnFinalBill(companyId: string, lrId: string) {
  const bill = billForLr(companyId, lrId);
  if (bill?.status === "final") fail("", `LR is on freight bill ${bill.billNo} and is locked`);
}

/** Filters shared by the register page and its Excel export, newest first. */
function filterLrs(companyId: string, params: LrListParams): LrView[] {
  const includeCancelled = params.status === "Cancelled";
  // "br 01 gn 8331" should find BR01GN8331.
  const truckQuery = params.search ? normaliseVehicleNo(params.search) : "";
  return scoped(db.lrs, companyId, includeCancelled)
    .filter((lr) => !params.truckId || lr.truckId === params.truckId)
    .filter(
      (lr) =>
        !params.partyId || [lr.consignorId, lr.consigneeId, lr.billedToId].includes(params.partyId),
    )
    .filter((lr) => !params.dateFrom || (lr.lrDate !== null && lr.lrDate >= params.dateFrom))
    .filter((lr) => !params.dateTo || (lr.lrDate !== null && lr.lrDate <= params.dateTo))
    .map(toLrView)
    .filter((v) => !params.status || v.status === params.status)
    .filter(
      (v) =>
        (truckQuery !== "" && !!v.truckNumber?.includes(truckQuery)) ||
        matchesSearch(
          params.search,
          v.lrNo,
          v.consignorName,
          v.consigneeName,
          v.billedToName,
          v.truckNumber,
          v.fromPlace,
          v.toPlace,
          ...v.lrInvoices.flatMap((i) => [i.invoiceNo, i.ewayBillNo]),
        ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** One page (max 50) of LRs matching the filters, with the total count. */
export async function listLrs(companyId: string, params: LrListParams = {}): Promise<Page<LrView>> {
  return paginate(filterLrs(companyId, params), params);
}

/** Most rows one Excel export returns. */
export const LR_EXPORT_LIMIT = 10_000;

/** Every LR matching the filters (up to LR_EXPORT_LIMIT), for the Excel export. */
export async function listLrsForExport(
  companyId: string,
  params: Omit<LrListParams, "page" | "pageSize"> = {},
): Promise<{ rows: LrView[]; total: number }> {
  const rows = filterLrs(companyId, params);
  return { rows: rows.slice(0, LR_EXPORT_LIMIT), total: rows.length };
}

export async function getLrById(companyId: string, id: string): Promise<LrView | null> {
  const lr = findById(db.lrs, companyId, id);
  return lr ? toLrView(lr) : null;
}

/**
 * The number the next new LR will get (prefix included), without taking it.
 * Shown on the New LR screen; the real number is allocated on save.
 */
export async function peekNextLrNo(
  companyId: string,
  lrDate?: string | null,
): Promise<string | null> {
  const company = db.companies.find((c) => c.id === companyId);
  if (!company) return null;
  const next = peekNumber(companyId, "lr", financialYear(lrDate ?? today()));
  return next === null ? null : `${company.lrPrefix}${next}`;
}

export type ConsignorDefaults = {
  /** Null when the values come from the party's saved defaults, not an earlier LR. */
  lrId: string | null;
  lrNo: string | null;
  fromPlace: string | null;
  chargedAs: ChargedAs | null;
  paymentMode: LrPaymentMode | null;
  gstPaidBy: GstPayer | null;
};

/** What to pre-fill when a consignor is picked: their latest booked LR, else the party's defaults. */
export async function getConsignorDefaults(
  companyId: string,
  consignorId: string,
): Promise<ConsignorDefaults | null> {
  const last = scoped(db.lrs, companyId)
    .filter((lr) => lr.consignorId === consignorId && lr.bookedAt)
    .sort((a, b) => b.bookedAt!.localeCompare(a.bookedAt!))[0];
  if (last) {
    return {
      lrId: last.id,
      lrNo: last.lrNo,
      fromPlace: last.fromPlace,
      chargedAs: last.chargedAs,
      paymentMode: last.paymentMode,
      gstPaidBy: last.gstPaidBy,
    };
  }
  const party = findById(db.parties, companyId, consignorId);
  if (
    !party ||
    (!party.defaultFrom &&
      !party.defaultChargedAs &&
      !party.defaultPaymentMode &&
      !party.defaultGstPayer)
  ) {
    return null;
  }
  return {
    lrId: null,
    lrNo: null,
    fromPlace: party.defaultFrom,
    chargedAs: party.defaultChargedAs,
    paymentMode: party.defaultPaymentMode,
    gstPaidBy: party.defaultGstPayer,
  };
}

/** "sq 2604-002116 " → "SQ2604-002116": how invoice numbers are compared for duplicates. */
export function normaliseInvoiceNo(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export type LrRef = { id: string; lrNo: string };

/**
 * Non-cancelled LRs of this company that already carry a goods invoice — matched by the linked
 * tax invoice or by invoice number. `exceptLrId` leaves out the LR being edited.
 */
export async function findLrsWithInvoice(
  companyId: string,
  match: { taxInvoiceId?: string | null; invoiceNo?: string | null },
  exceptLrId?: string,
): Promise<LrRef[]> {
  const no = match.invoiceNo ? normaliseInvoiceNo(match.invoiceNo) : "";
  if (!match.taxInvoiceId && !no) return [];
  return scoped(db.lrs, companyId)
    .filter((lr) => lr.id !== exceptLrId)
    .filter((lr) =>
      lr.lrInvoices.some(
        (i) =>
          (match.taxInvoiceId && i.taxInvoiceId === match.taxInvoiceId) ||
          (no !== "" && normaliseInvoiceNo(i.invoiceNo) === no),
      ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((lr) => ({ id: lr.id, lrNo: lr.lrNo }));
}

/** "To" for a picked consignee: their latest booked LR's destination, else the party's place. */
export async function getConsigneeToPlace(
  companyId: string,
  consigneeId: string,
): Promise<string | null> {
  const last = scoped(db.lrs, companyId)
    .filter((lr) => lr.consigneeId === consigneeId && lr.bookedAt && lr.toPlace)
    .sort((a, b) => b.bookedAt!.localeCompare(a.bookedAt!))[0];
  return last?.toPlace ?? findById(db.parties, companyId, consigneeId)?.place ?? null;
}

export type SaveLrOptions = {
  /** Also book the LR (Draft → Booked) in the same write. */
  book?: boolean;
};

/** The LR record for validated input, without a number or a booking (shared by create and import). */
function buildLr(companyId: string, v: ParsedLr, t: string): Lr {
  const nested = normaliseNested(v);
  return {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    lrNo: "",
    lrDate: v.lrDate ?? null,
    fromPlace: v.fromPlace ?? null,
    toPlace: v.toPlace ?? null,
    risk: v.risk ?? "owner",
    consignorId: v.consignorId ?? null,
    consigneeId: v.consigneeId ?? null,
    billedToId: v.billedToId ?? null,
    gstPaidBy: v.gstPaidBy ?? null,
    paymentMode: v.paymentMode ?? null,
    chargedAs: v.chargedAs ?? null,
    ratePaise: v.ratePaise ?? null,
    truckId: v.truckId ?? null,
    driverMobile: v.driverMobile ?? null,
    lrInvoices: nested.lrInvoices ?? [],
    items: nested.items ?? [],
    charges: { ...EMPTY_CHARGES, ...v.charges },
    remarks: v.remarks ?? null,
    bookedAt: null,
    dispatchedAt: null,
    deliveredAt: null,
    snapshot: null,
  };
}

/**
 * Creates an LR (a draft, or booked when `book` is set). Its number is taken from the
 * company's LR series on create — only after validation passes, so a failed save leaves no gap.
 */
export async function createLr(
  companyId: string,
  input: LrInput,
  options: SaveLrOptions = {},
): Promise<LrView> {
  await assertCan(companyId, "lr.edit");
  const v = parseInput(lrFields, input);
  assertLrRefs(companyId, v);
  const company = db.companies.find((c) => c.id === companyId)!;
  const t = now();
  const lr = buildLr(companyId, v, t);
  if (options.book) {
    assertRules(lrBookingErrors(lr));
    lr.bookedAt = t;
  }
  const no = allocateNumber(companyId, "lr", financialYear(v.lrDate ?? today()));
  lr.lrNo = `${company.lrPrefix}${no}`;
  if (options.book) lr.snapshot = snapshotFor(lr);
  return toLrView(insertRecord("lrs", db.lrs, lr));
}

/**
 * Smart import: a draft LR that keeps the number from the sheet (digits; the company prefix is
 * added). Moves the LR series past it so the next new LR can't collide. Callers run it inside
 * the import's transaction.
 */
export async function createImportedLr(
  companyId: string,
  input: LrInput,
  lrDigits: string,
  importBatchId: string,
): Promise<LrView> {
  await assertCan(companyId, "lr.edit");
  const v = parseInput(lrFields, input);
  assertLrRefs(companyId, v);
  const company = db.companies.find((c) => c.id === companyId)!;
  const n = Number(lrDigits);
  const lrNo = `${company.lrPrefix}${n}`;
  if (db.lrs.some((l) => l.companyId === companyId && l.lrNo === lrNo)) {
    fail("lrNo", `LR ${lrNo} already exists`);
  }
  const lr = buildLr(companyId, v, now());
  lr.lrNo = lrNo;
  lr.importBatchId = importBatchId;
  const fy = financialYear(today());
  const next = peekNumber(companyId, "lr", fy);
  if (next === null || n + 1 > next) raiseNumber(companyId, "lr", fy, n + 1, "lrNo");
  return toLrView(insertRecord("lrs", db.lrs, lr));
}

export async function updateLr(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: LrPatch,
  options: SaveLrOptions = {},
): Promise<LrView> {
  await assertCan(companyId, "lr.edit");
  assertNotOnFinalBill(companyId, id);
  const p = parseInput(lrPatchSchema, patch);
  assertLrRefs(companyId, p);
  const nested = normaliseNested(p);
  const saved = updateRecord(
    "lrs",
    db.lrs,
    companyId,
    id,
    expectedVersion,
    (current) => {
      const next: Lr = {
        ...current,
        ...p,
        items: nested.items ?? current.items,
        lrInvoices: nested.lrInvoices ?? current.lrInvoices,
        charges: { ...current.charges, ...p.charges },
      };
      if (options.book && !next.bookedAt) next.bookedAt = now();
      if (next.bookedAt) {
        assertRules(lrBookingErrors(next));
        // A booked LR keeps its snapshot, except for a party that was swapped for another.
        const fresh = snapshotFor(next)!;
        next.snapshot = {
          company: current.snapshot?.company ?? fresh.company,
          consignor:
            next.consignorId === current.consignorId
              ? (current.snapshot?.consignor ?? fresh.consignor)
              : fresh.consignor,
          consignee:
            next.consigneeId === current.consigneeId
              ? (current.snapshot?.consignee ?? fresh.consignee)
              : fresh.consignee,
          billedTo:
            next.billedToId === current.billedToId
              ? (current.snapshot?.billedTo ?? fresh.billedTo)
              : fresh.billedTo,
        };
      }
      return next;
    },
    "LR",
  );
  return toLrView(saved);
}

/** Draft → Booked: checks required fields and stores the party + company snapshot. */
export async function bookLr(
  companyId: string,
  id: string,
  expectedVersion: number,
): Promise<LrView> {
  await assertCan(companyId, "lr.edit");
  const saved = updateRecord(
    "lrs",
    db.lrs,
    companyId,
    id,
    expectedVersion,
    (current) => {
      if (current.bookedAt) fail("", "LR is already booked");
      assertRules(lrBookingErrors(current));
      const next = { ...current, bookedAt: now() };
      return { ...next, snapshot: snapshotFor(next) };
    },
    "LR",
  );
  return toLrView(saved);
}

/** Booked → In transit. Needs a truck. */
export async function dispatchLr(
  companyId: string,
  id: string,
  expectedVersion: number,
): Promise<LrView> {
  await assertCan(companyId, "lr.edit");
  const saved = updateRecord(
    "lrs",
    db.lrs,
    companyId,
    id,
    expectedVersion,
    (current) => {
      if (!current.bookedAt) fail("", "Book the LR before dispatching it");
      if (!current.truckId) fail("truckId", "Pick a truck before dispatching");
      if (current.dispatchedAt) return current;
      return { ...current, dispatchedAt: now() };
    },
    "LR",
  );
  return toLrView(saved);
}

/** Soft-cancels an LR with a reason. Not allowed while it is on a freight bill. */
export async function cancelLr(
  companyId: string,
  id: string,
  input: LrCancelInput,
): Promise<LrView> {
  await assertCan(companyId, "record.cancel");
  const { reason } = parseInput(lrCancelSchema, input);
  const bill = billForLr(companyId, id);
  if (bill)
    fail("", `LR is on freight bill ${bill.billNo ?? "(draft)"} — remove it from the bill first`);
  return toLrView(cancelRecord("lrs", db.lrs, companyId, id, "LR", { cancelReason: reason }));
}

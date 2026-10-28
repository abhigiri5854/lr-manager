import { financialYear } from "@/lib/fy";
import { companySnapshot, partySnapshot } from "@/lib/snapshots";
import type { Lr, LrCharges, LrStatus, LrView, Page } from "@/lib/types";
import {
  lrBookingErrors,
  lrFields,
  lrPatchSchema,
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
  insertRecord,
  matchesSearch,
  newId,
  now,
  paginate,
  parseInput,
  scoped,
  today,
  updateRecord,
  type ListParams,
} from "./_store";

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

export async function listLrs(companyId: string, params: LrListParams = {}): Promise<Page<LrView>> {
  const includeCancelled = params.status === "Cancelled";
  const rows = scoped(db.lrs, companyId, includeCancelled)
    .filter((lr) => !params.truckId || lr.truckId === params.truckId)
    .filter(
      (lr) =>
        !params.partyId || [lr.consignorId, lr.consigneeId, lr.billedToId].includes(params.partyId),
    )
    .filter((lr) => !params.dateFrom || (lr.lrDate !== null && lr.lrDate >= params.dateFrom))
    .filter((lr) => !params.dateTo || (lr.lrDate !== null && lr.lrDate <= params.dateTo))
    .map(toLrView)
    .filter((v) => !params.status || v.status === params.status)
    .filter((v) =>
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
  return paginate(rows, params);
}

export async function getLrById(companyId: string, id: string): Promise<LrView | null> {
  const lr = findById(db.lrs, companyId, id);
  return lr ? toLrView(lr) : null;
}

/** Creates a draft LR. Its number is taken from the company's LR series straight away. */
export async function createLr(companyId: string, input: LrInput): Promise<LrView> {
  const v = parseInput(lrFields, input);
  assertLrRefs(companyId, v);
  const company = db.companies.find((c) => c.id === companyId)!;
  const no = allocateNumber(companyId, "lr", financialYear(v.lrDate ?? today()));
  const nested = normaliseNested(v);
  const t = now();
  const lr: Lr = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    lrNo: `${company.lrPrefix}${no}`,
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
  return toLrView(insertRecord("lrs", db.lrs, lr));
}

export async function updateLr(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: LrPatch,
): Promise<LrView> {
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

export async function cancelLr(companyId: string, id: string): Promise<LrView> {
  const bill = billForLr(companyId, id);
  if (bill)
    fail("", `LR is on freight bill ${bill.billNo ?? "(draft)"} — remove it from the bill first`);
  return toLrView(cancelRecord("lrs", db.lrs, companyId, id, "LR"));
}

// The parts of creating / editing an LR that don't depend on where it is stored (mock or
// database): normalised lines, the record built from validated input, and a patch applied to an
// existing LR with the booking rules and the snapshot rule.
import type { Lr, LrCharges } from "@/lib/types";
import { lrBookingErrors, lrFields, lrPatchSchema } from "@/lib/validators/lr";
import { assertRules, authorStamp, newId } from "./_store";

export const EMPTY_CHARGES: LrCharges = {
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

export type ParsedLr = ReturnType<typeof lrFields.parse>;
export type ParsedPatch = ReturnType<typeof lrPatchSchema.parse>;

export type SaveLrOptions = {
  /** Also book the LR (Draft → Booked) in the same write. */
  book?: boolean;
};

/** Fill ids and nulls on nested rows. */
export function normaliseNested(v: Pick<ParsedLr, "items" | "lrInvoices">) {
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

/** The LR record for validated input, without a number or a booking (shared by create and import). */
export function buildLr(companyId: string, v: ParsedLr, t: string): Lr {
  const nested = normaliseNested(v);
  return {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...authorStamp(),
    podReceivedAt: null,
    billedAt: null,
    paidAt: null,
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

const weight = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Everything on an LR except its dates, in a form that compares equal across mock / DB. */
function withoutDates(lr: Lr) {
  return {
    fields: [
      lr.fromPlace,
      lr.toPlace,
      lr.risk,
      lr.consignorId,
      lr.consigneeId,
      lr.billedToId,
      lr.gstPaidBy,
      lr.paymentMode,
      lr.chargedAs,
      lr.ratePaise,
      lr.truckId,
      lr.driverMobile,
      lr.remarks,
    ].map((v) => v ?? null),
    charges: (Object.keys(EMPTY_CHARGES) as (keyof LrCharges)[]).map((k) => lr.charges[k] ?? null),
    items: lr.items.map((i) => [
      i.itemId ?? null,
      i.description,
      i.packages,
      weight(i.actualWeight),
      weight(i.chargedWeight),
      i.size ?? null,
    ]),
    invoices: lr.lrInvoices.map((i) => [
      i.id,
      i.invoiceNo,
      i.valuePaise ?? null,
      i.ewayBillNo ?? null,
      i.taxInvoiceId ?? null,
    ]),
  };
}

/**
 * An LR on a finalised freight bill is locked except for its dates (LR date, goods invoice dates,
 * e-way expiry). Returns `current` with only those dates taken from `next`, or null when
 * anything else was changed.
 */
export function lockedLrDates(current: Lr, next: Lr): Lr | null {
  if (JSON.stringify(withoutDates(current)) !== JSON.stringify(withoutDates(next))) return null;
  const dated: Lr = {
    ...current,
    lrDate: next.lrDate,
    lrInvoices: current.lrInvoices.map((inv, i) => ({
      ...inv,
      invoiceDate: next.lrInvoices[i].invoiceDate,
      ewayExpiresAt: next.lrInvoices[i].ewayExpiresAt,
    })),
  };
  if (dated.bookedAt) assertRules(lrBookingErrors(dated));
  return dated;
}

export const lockedOnBill = (billNo: string | null) =>
  `LR is on freight bill ${billNo ?? ""} and is locked — only its dates can change`;

/**
 * The LR after an edit. A booked LR (or one being booked) must still pass the booking rules and
 * keeps its snapshot, except for a party that was swapped for another one (`fresh` builds the
 * snapshot from the current party / company records).
 */
export function applyPatch(
  current: Lr,
  p: ParsedPatch,
  nested: ReturnType<typeof normaliseNested>,
  options: SaveLrOptions,
  fresh: (lr: Lr) => NonNullable<Lr["snapshot"]>,
  at: string,
): Lr {
  const next: Lr = {
    ...current,
    ...p,
    items: nested.items ?? current.items,
    lrInvoices: nested.lrInvoices ?? current.lrInvoices,
    charges: { ...current.charges, ...p.charges },
  };
  if (options.book && !next.bookedAt) next.bookedAt = at;
  if (next.bookedAt) {
    assertRules(lrBookingErrors(next));
    const now = fresh(next);
    next.snapshot = {
      company: current.snapshot?.company ?? now.company,
      consignor:
        next.consignorId === current.consignorId
          ? (current.snapshot?.consignor ?? now.consignor)
          : now.consignor,
      consignee:
        next.consigneeId === current.consigneeId
          ? (current.snapshot?.consignee ?? now.consignee)
          : now.consignee,
      billedTo:
        next.billedToId === current.billedToId
          ? (current.snapshot?.billedTo ?? now.billedTo)
          : now.billedTo,
    };
  }
  return next;
}

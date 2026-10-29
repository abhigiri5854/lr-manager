// Freight bill rules shared by the mock store and the database. Pure.
import { formatPaise } from "@/lib/format";
import { financialYear } from "@/lib/fy";
import { computeFreightGst } from "@/lib/tax";
import type { FreightBill, FreightBillLine } from "@/lib/types";
import {
  paymentRuleErrors,
  type freightBillFields,
  type paymentFields,
} from "@/lib/validators/bill";
import { assertRules, fail, newId } from "./_store";

export type ParsedBillLine = ReturnType<typeof freightBillFields.parse>["lines"][number];

/** Line totals, bill totals and GST (SGST+CGST within the state, IGST across). */
export function priceBill(
  companyGstin: string,
  partyState: string | null,
  gstMode: FreightBill["gstMode"],
  gstRateBp: number,
  lines: Array<ParsedBillLine | FreightBillLine>,
) {
  const out: FreightBillLine[] = lines.map((l) => {
    const detention = l.detentionPaise ?? 0;
    const other = l.otherPaise ?? 0;
    const advance = l.advancePaise ?? 0;
    return {
      id: l.id ?? newId(),
      lrId: l.lrId,
      freightPaise: l.freightPaise,
      detentionPaise: detention,
      otherPaise: other,
      advancePaise: advance,
      totalPaise: l.freightPaise + detention + other,
    };
  });
  const charges = out.reduce((s, l) => s + l.totalPaise, 0);
  const advance = out.reduce((s, l) => s + l.advancePaise, 0);
  const gst = computeFreightGst(charges, gstMode, gstRateBp, partyState === companyGstin.slice(0, 2));
  return {
    lines: out,
    totals: {
      chargesPaise: charges,
      ...gst,
      advancePaise: advance,
      amountPaise: charges + gst.sgstPaise + gst.cgstPaise + gst.igstPaise - advance,
    },
  };
}

/** What a bill line's LR is, for the billable-LR checks. */
export type LrForBill = {
  lrNo: string;
  live: boolean;
  booked: boolean;
  /** Another live bill (draft or final) this LR is on, or null. */
  otherBill: { id: string; billNo: string | null } | null;
};

/** LRs must be booked, live, and not on another bill. */
export function assertBillableLrs(
  lines: Array<{ lrId: string }>,
  lrFor: (lrId: string) => LrForBill | undefined,
  billId?: string,
) {
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    const path = `lines.${i}.lrId`;
    const lr = lrFor(l.lrId);
    if (!lr || !lr.live) fail(path, "LR not found in this company");
    if (!lr.booked) fail(path, `LR ${lr.lrNo} is a draft — book it before billing`);
    if (seen.has(l.lrId)) fail(path, `LR ${lr.lrNo} is ticked twice`);
    seen.add(l.lrId);
    if (lr.otherBill && lr.otherBill.id !== billId) {
      fail(path, `LR ${lr.lrNo} is already on bill ${lr.otherBill.billNo ?? "(draft)"}`);
    }
  });
}

export const BILL_FINAL =
  "Finalised bills can't be edited — only the bill date can change; cancel and re-issue for the rest";

/**
 * A finalised bill with a new date. Anything else in the patch is refused; lines and totals stay
 * as finalised, and the number keeps its FY even when the date moves to another one.
 */
export function applyFinalBillDate(
  current: FreightBill,
  p: Partial<ReturnType<typeof freightBillFields.parse>>,
): FreightBill {
  const other = Object.entries(p).some(([k, v]) => v !== undefined && k !== "billDate");
  if (other) fail("", BILL_FINAL);
  return {
    ...current,
    numberFy: current.numberFy ?? financialYear(current.billDate),
    billDate: p.billDate ?? current.billDate,
  };
}
export const BILL_HAS_PAYMENTS =
  "Payments are recorded against this bill — cancel or re-allocate them first";

export type ParsedPayment = ReturnType<typeof paymentFields.parse>;

/** What the allocation checks need about one bill. */
export type BillForPayment = {
  billNo: string | null;
  live: boolean;
  final: boolean;
  partyId: string;
  amountPaise: number;
  /** Received against it from other live payments. */
  receivedPaise: number;
};

/** Amount rules, then each allocation: a live final bill of the same party, not over its due. */
export function checkAllocations(
  v: ParsedPayment,
  billFor: (id: string) => BillForPayment | undefined,
) {
  const allocations = v.allocations ?? [];
  assertRules(
    paymentRuleErrors({ amountPaise: v.amountPaise, tdsPaise: v.tdsPaise ?? 0, allocations }),
  );
  allocations.forEach((a, i) => {
    const bill = billFor(a.freightBillId);
    if (!bill || !bill.live || !bill.final) {
      fail(`allocations.${i}.freightBillId`, "Bill not found or not final");
    }
    if (bill.partyId !== v.partyId)
      fail(`allocations.${i}.freightBillId`, `Bill ${bill.billNo} is for another party`);
    const due = bill.amountPaise - bill.receivedPaise;
    if (a.amountPaise > due) {
      fail(
        `allocations.${i}.amountPaise`,
        `More than the ₹${formatPaise(due)} due on bill ${bill.billNo}`,
      );
    }
  });
  return allocations;
}

/** "FB/" + 7 → "FB/007". */
export const formatBillNo = (prefix: string, n: number) => `${prefix}${String(n).padStart(3, "0")}`;

// Record-payment form: oldest-first allocation and the step from form values to the validated
// input. Pure, no data access.
import { parseRupees } from "@/lib/format";
import type { ReceiptMode } from "@/lib/types";
import type { PaymentInput } from "@/lib/validators/bill";

export const RECEIPT_MODES: { value: ReceiptMode; label: string }[] = [
  { value: "neft_upi", label: "NEFT / UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
];

export const receiptModeLabel = Object.fromEntries(
  RECEIPT_MODES.map((m) => [m.value, m.label]),
) as Record<ReceiptMode, string>;

/** Spreads `totalPaise` over bills in the order given (oldest first); the rest is on account. */
export function allocateOldestFirst(
  bills: { id: string; duePaise: number }[],
  totalPaise: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  let left = Math.max(0, totalPaise);
  for (const b of bills) {
    if (left <= 0) break;
    const take = Math.min(left, b.duePaise);
    if (take > 0) out[b.id] = take;
    left -= take;
  }
  return out;
}

export type PaymentFormValues = {
  partyId: string;
  amount: string;
  tds: string;
  mode: ReceiptMode;
  receivedOn: string;
  reference: string;
  /** Text per bill id. */
  alloc: Record<string, string>;
};

export type PaymentFormErrors = Record<string, string>;

const amountOf = (text: string): number | null => {
  const v = parseRupees(text);
  return v === undefined ? null : (v ?? 0);
};

/** Sums of the form: money in, allocated to bills, left on account. */
export function paymentTotals(v: PaymentFormValues) {
  const total = (amountOf(v.amount) ?? 0) + (amountOf(v.tds) ?? 0);
  const allocated = Object.values(v.alloc).reduce((s, t) => s + (amountOf(t) ?? 0), 0);
  return { totalPaise: total, allocatedPaise: allocated, onAccountPaise: total - allocated };
}

export function formToPaymentInput(
  v: PaymentFormValues,
  due: Record<string, number>,
): { ok: true; input: PaymentInput } | { ok: false; errors: PaymentFormErrors } {
  const errors: PaymentFormErrors = {};
  if (!v.partyId) errors.partyId = "Pick the party";
  const amount = parseRupees(v.amount);
  if (amount === undefined) errors.amount = "Not an amount";
  else if (!amount) errors.amount = "Enter an amount";
  const tds = amountOf(v.tds);
  if (tds === null) errors.tds = "Not an amount";
  if (!v.receivedOn) errors.receivedOn = "Enter the date";

  const allocations: NonNullable<PaymentInput["allocations"]> = [];
  for (const [billId, text] of Object.entries(v.alloc)) {
    const paise = amountOf(text);
    if (paise === null) errors[`alloc.${billId}`] = "Not an amount";
    else if (paise > (due[billId] ?? 0)) errors[`alloc.${billId}`] = "More than is due";
    else if (paise > 0) allocations.push({ freightBillId: billId, amountPaise: paise });
  }
  if (!Object.keys(errors).length) {
    const { allocatedPaise, totalPaise } = paymentTotals(v);
    if (allocatedPaise > totalPaise) errors.alloc = "Allocated more than amount + TDS";
  }
  if (Object.keys(errors).length || !amount || tds === null) return { ok: false, errors };
  return {
    ok: true,
    input: {
      partyId: v.partyId,
      amountPaise: amount,
      tdsPaise: tds,
      mode: v.mode,
      receivedOn: v.receivedOn,
      reference: v.reference.trim() || undefined,
      allocations,
    },
  };
}

/** Maps a server validation path back to a form field key. */
export function paymentErrorKey(path: string, billIds: string[]): string {
  const m = /^allocations\.(\d+)\.(\w+)$/.exec(path);
  if (m) return `alloc.${billIds[Number(m[1])] ?? ""}`;
  if (path === "amountPaise") return "amount";
  if (path === "tdsPaise") return "tds";
  return path;
}

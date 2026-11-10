// Truck payment rules (TIER1-MARKET-TRUCKS.md §2 D5/D6, §6 screen 4, §9 decisions 1, 2, 5).
// Pure functions in integer paise; the data layer (lib/data/db/truck-payments.ts) loads the inputs
// under row locks and turns issues into a ValidationError.
//
// Money model, matching v_challan_balance (net_payable = gross_credit − deductions − tds; balance =
// net_payable − paid): an allocation stores `amount` = cash paid (net) and `tds_amount` separately,
// so the part of the challan it settles is amount + tds_amount ("gross").
import { tdsPaise } from "./calc";
import { fromPaise, toMilli, type Money } from "./money";

export type PaymentAllocationKind = "advance" | "balance";
export type TruckPaymentMode = "bank" | "upi" | "cash" | "cheque" | "diesel";

/** A field error, same shape as ValidationError issues (path like "allocations.0.amount"). */
export interface PaymentIssue {
  path: string;
  message: string;
}

export type PaymentWarningCode =
  | "duplicate"
  | "bank_changed"
  | "payee_unverified"
  | "no_bank_details"
  | "no_upi_target"
  | "cash_limit"
  | "balance_before_pod"
  | "tds_no_pan"
  | "no_tds_declaration";

export interface PaymentWarning {
  code: PaymentWarningCode;
  message: string;
}

export interface PaymentLineInput {
  challanId: string;
  kind: PaymentAllocationKind;
  /** The part of the challan this line settles (cash + TDS), paise. */
  grossPaise: number;
  /** The challan's gross credit (hire + additions) — the TDS base (§4). */
  tdsBasePaise: number;
}

export interface PaymentLine extends PaymentLineInput {
  tdsPaise: number;
  /** Cash paid = gross − TDS. */
  netPaise: number;
}

export interface PaymentCalc {
  lines: PaymentLine[];
  grossPaise: number;
  tdsPaise: number;
  netPaise: number;
  issues: PaymentIssue[];
}

const rupees = (paise: number) => `₹${fromPaise(paise)}`;

/**
 * TDS % is manual (default 0) and applies to BALANCE lines only: tds = round(challan gross credit ×
 * % / 100); net = gross − tds. Advances never carry TDS.
 */
export function calcTruckPayment(
  tdsPercent: Money | null | undefined,
  input: readonly PaymentLineInput[],
): PaymentCalc {
  const issues: PaymentIssue[] = [];
  let pct: Money = tdsPercent ?? 0;
  let milli = 0;
  try {
    milli = toMilli(pct);
  } catch {
    issues.push({ path: "tdsPercent", message: "TDS % must be a number between 0 and 100" });
    pct = 0;
  }
  if (milli > 100_000) {
    issues.push({ path: "tdsPercent", message: "TDS % can't be more than 100" });
    pct = 0;
    milli = 0;
  }
  if (milli > 0 && !input.some((l) => l.kind === "balance")) {
    issues.push({
      path: "tdsPercent",
      message: "TDS is deducted on the balance payment only — this payment has no balance line",
    });
  }

  const seen = new Set<string>();
  const lines = input.map((l, i): PaymentLine => {
    const key = `${l.challanId}|${l.kind}`;
    if (seen.has(key))
      issues.push({ path: `allocations.${i}.kind`, message: `This challan already has a ${l.kind} line` });
    seen.add(key);
    if (!Number.isInteger(l.grossPaise) || l.grossPaise <= 0) {
      issues.push({ path: `allocations.${i}.amount`, message: "Enter an amount above 0" });
      return { ...l, tdsPaise: 0, netPaise: 0 };
    }
    const tds = l.kind === "balance" && milli > 0 ? tdsPaise(Math.max(0, l.tdsBasePaise), pct) : 0;
    if (tds > l.grossPaise)
      issues.push({
        path: `allocations.${i}.amount`,
        message: `TDS (${rupees(tds)}) is more than this line (${rupees(l.grossPaise)})`,
      });
    return { ...l, tdsPaise: tds, netPaise: l.grossPaise - tds };
  });

  const grossPaise = lines.reduce((s, l) => s + l.grossPaise, 0);
  const tds = lines.reduce((s, l) => s + l.tdsPaise, 0);
  const netPaise = grossPaise - tds;
  if (lines.length && netPaise <= 0 && !issues.length)
    issues.push({ path: "allocations", message: "The amount to pay must be above 0" });
  return { lines, grossPaise, tdsPaise: tds, netPaise, issues };
}

export interface ChallanRoom {
  challanNo: string;
  /** hire + additions − deductions: everything the challan can ever pay out (cash + TDS). */
  payablePaise: number;
  /** Gross (amount + TDS) of the challan's other live allocations: draft, pending, approved, paid. */
  committedPaise: number;
  /** TDS already on the challan's other live allocations. */
  tdsTakenPaise: number;
}

/**
 * Overpay guard: Σ live allocations per challan ≤ payable. Also stops a second TDS deduction on a
 * challan (TDS is computed on the whole gross credit, once, at balance).
 */
export function overpayIssues(
  lines: readonly PaymentLine[],
  rooms: ReadonlyMap<string, ChallanRoom>,
): PaymentIssue[] {
  const issues: PaymentIssue[] = [];
  const first = new Map<string, number>();
  const sum = new Map<string, number>();
  lines.forEach((l, i) => {
    if (!first.has(l.challanId)) first.set(l.challanId, i);
    sum.set(l.challanId, (sum.get(l.challanId) ?? 0) + l.grossPaise);
    const room = rooms.get(l.challanId);
    if (room && l.tdsPaise > 0 && room.tdsTakenPaise > 0)
      issues.push({
        path: `allocations.${i}.amount`,
        message: `TDS is already deducted on challan ${room.challanNo}`,
      });
  });
  for (const [challanId, total] of sum) {
    const room = rooms.get(challanId);
    if (!room) continue;
    const left = room.payablePaise - room.committedPaise;
    if (total > left)
      issues.push({
        path: `allocations.${first.get(challanId)}.amount`,
        message:
          left <= 0
            ? `Challan ${room.challanNo}: nothing left to pay (other payments already cover it)`
            : `Challan ${room.challanNo}: only ${rupees(left)} left to pay`,
      });
  }
  return issues;
}

/** Maker-checker: gross above the company limit needs an approver. Limit null = off, 0 = every payment. */
export function needsApproval(grossPaise: number, limitPaise: number | null): boolean {
  return limitPaise !== null && grossPaise > limitPaise;
}

export interface SafeguardInput {
  mode: TruckPaymentMode;
  netPaise: number;
  tdsPaise: number;
  hasBalance: boolean;
  payee: {
    verified: boolean;
    blacklisted: boolean;
    pan: string | null;
    bankChangedAt: string | null;
    /** Payee has both an account number and an IFSC on file. */
    hasBankDetails: boolean;
  };
  /** UPI mode: a UPI ID or QR is on the payment (typed or taken from the payee). */
  hasUpiTarget: boolean;
  now: Date;
  /** Company setting; null / 0 = no cooling period (default null). */
  coolingHours: number | null;
  /** Company setting; null = no cash warning. */
  cashLimitPaise: number | null;
  declarationOnFile: boolean;
  /** Challan numbers with a BALANCE line whose POD isn't received yet. */
  balanceBeforePod: string[];
  podOverrideReason: string | null;
  /** Live payments in the last 24 h with the same payee, challan and amount. */
  duplicates: string[];
  confirmDuplicate: boolean;
  /** The acting user has payment.approve. */
  canApprove: boolean;
}

export interface SafeguardResult {
  warnings: PaymentWarning[];
  blocks: PaymentIssue[];
  /** Must go to an approver whatever the amount (balance before POD by a non-approver). */
  needsApprover: boolean;
}

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** D5 payment safety. Warnings are stored on the payment; blocks stop the save. */
export function paymentSafeguards(i: SafeguardInput): SafeguardResult {
  const warnings: PaymentWarning[] = [];
  const blocks: PaymentIssue[] = [];
  let needsApprover = false;

  if (i.payee.blacklisted)
    blocks.push({ path: "payeePartyId", message: "This payee is blacklisted — payments are blocked" });
  else if (!i.payee.verified)
    warnings.push({ code: "payee_unverified", message: "Payee is not verified yet" });

  if (i.duplicates.length) {
    const msg = `Same payee, challan and amount as ${i.duplicates.join(", ")} in the last 24 hours`;
    if (i.confirmDuplicate) warnings.push({ code: "duplicate", message: `${msg} (confirmed)` });
    else blocks.push({ path: "confirmDuplicate", message: `${msg}. Confirm to pay again.` });
  }

  if (i.mode === "bank" && !i.payee.hasBankDetails)
    warnings.push({
      code: "no_bank_details",
      message: "Payee has no bank account / IFSC on file — check the details before paying",
    });
  if (i.mode === "upi" && !i.hasUpiTarget)
    warnings.push({ code: "no_upi_target", message: "No UPI ID or QR on this payment or the payee" });

  const cooling = i.coolingHours !== null && i.coolingHours > 0 ? i.coolingHours : 0;
  if ((i.mode === "bank" || i.mode === "upi") && i.payee.bankChangedAt && cooling > 0) {
    const changed = Date.parse(i.payee.bankChangedAt);
    const until = changed + cooling * 3_600_000;
    if (!Number.isNaN(changed) && i.now.getTime() < until) {
      const msg = `Bank / UPI details changed less than ${cooling} hours ago`;
      if (i.canApprove) warnings.push({ code: "bank_changed", message: msg });
      else
        blocks.push({
          path: "mode",
          message: `${msg} — an approver must make this payment, or wait for the cooling period`,
        });
    }
  }

  if (i.mode === "cash" && i.cashLimitPaise !== null && i.netPaise > i.cashLimitPaise)
    warnings.push({
      code: "cash_limit",
      message: `Cash ${rupees(i.netPaise)} is over the cash limit of ${rupees(i.cashLimitPaise)}`,
    });

  if (i.balanceBeforePod.length) {
    const nos = i.balanceBeforePod.join(", ");
    if (!i.podOverrideReason?.trim())
      blocks.push({
        path: "podOverrideReason",
        message: `POD not received for ${nos} — enter why the balance is paid before POD`,
      });
    else {
      warnings.push({
        code: "balance_before_pod",
        message: `Balance paid before POD (${nos}): ${i.podOverrideReason.trim()}`,
      });
      if (!i.canApprove) needsApprover = true;
    }
  }

  if (i.tdsPaise > 0 && !PAN.test((i.payee.pan ?? "").trim().toUpperCase()))
    warnings.push({ code: "tds_no_pan", message: "TDS deducted but the payee has no valid PAN on file" });
  if (i.hasBalance && !i.declarationOnFile)
    warnings.push({
      code: "no_tds_declaration",
      message: "No TDS declaration on file for this financial year",
    });

  return { warnings, blocks, needsApprover };
}

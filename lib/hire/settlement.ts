// POD settlement rules (TIER1-MARKET-TRUCKS.md §4, §6 screen 3, §9 #3/#4). Pure, paise in / out.
// Owner decision: payments are OPTIONAL — nothing here looks at payments; a challan settles on its POD.
import { latePodFeePaise, sumChargesPaise, type HireCharge } from "./calc";
import { fromPaise, toMilli, toPaise, type Money } from "./money";

export type PodAutoKind = "late_pod" | "shortage";
export type ShortageRateSource = "party_rate" | "truck_rate";
export type SettlementChallanStatus =
  | "draft"
  | "dispatched"
  | "in_transit"
  | "reached"
  | "pod_received"
  | "settled";

/** Statuses in which POD details and POD charges can still change. */
export const POD_OPEN_STATUSES: readonly SettlementChallanStatus[] = [
  "dispatched",
  "in_transit",
  "reached",
  "pod_received",
];

export const SETTLED_LOCKED = "This challan is settled — reopen it to change the POD details";

function roundDiv(n: number, d: number): number {
  if (d <= 0) return 0;
  return Number((BigInt(n) * 2n + BigInt(d)) / (2n * BigInt(d)));
}

// ---------- late POD ----------
export interface LatePodRule {
  allowedDays: number | null | undefined;
  fee: Money | null | undefined;
}

/** The challan's own days / fee (set on the challan) win over the company setting, field by field. */
export function latePodRule(company: LatePodRule, challan: LatePodRule): LatePodRule {
  return {
    allowedDays: challan.allowedDays ?? company.allowedDays ?? null,
    fee: challan.fee ?? company.fee ?? null,
  };
}

/** Auto late-POD fee: 0 until both dates are known, or when the rule isn't configured. */
export function latePodAutoPaise(
  unloadedAt: string | null | undefined,
  podReceivedAt: string | null | undefined,
  rule: LatePodRule,
): number {
  if (!unloadedAt || !podReceivedAt) return 0;
  if (rule.allowedDays === null || rule.allowedDays === undefined) return 0;
  if (rule.fee === null || rule.fee === undefined) return 0;
  return latePodFeePaise(unloadedAt, podReceivedAt, rule.allowedDays, rule.fee);
}

export interface AutoOverride {
  amount: Money;
  reason: string;
}

/** What a system line charges: the user's override (needs a reason) or the computed amount. */
export function appliedAutoPaise(
  autoPaise: number,
  override: AutoOverride | null | undefined,
): { paise: number; overridden: boolean } {
  if (!override) return { paise: autoPaise, overridden: false };
  if (!override.reason.trim()) throw new Error("An override needs a reason");
  const paise = toPaise(override.amount);
  if (paise < 0) throw new Error("Amount can't be negative");
  return { paise, overridden: true };
}

// ---------- shortage ----------
export interface ShortageSettings {
  /** Company setting: off = no auto shortage at all. */
  enabled: boolean;
  /** % of loaded packages tolerated before deducting (rounded down). */
  allowancePct: Money | null | undefined;
  /** Default truck_rate (the shortage is deducted from the truck). */
  rateSource: ShortageRateSource | string | null | undefined;
}

export interface ShortageLineInput {
  loadedPkgs: number;
  deliveredPkgs: number | null | undefined;
  /** LR freight allocated to this line (party rate source). */
  freightAllocated: Money;
}

export interface ShortageResult {
  shortPkgs: number;
  allowancePkgs: number;
  ratePerPkgPaise: number;
  amountPaise: number;
}

const NO_SHORTAGE: ShortageResult = { shortPkgs: 0, allowancePkgs: 0, ratePerPkgPaise: 0, amountPaise: 0 };

/** floor(loaded × pct / 100). */
export function shortageAllowancePkgs(loadedPkgs: number, pct: Money | null | undefined): number {
  const milli = toMilli(pct ?? 0);
  if (milli < 0 || milli > 100_000) throw new Error("Allowance % must be 0–100");
  return Math.floor((loadedPkgs * milli) / 100_000);
}

/** Party rate = line freight ÷ its packages; truck rate = hire ÷ all packages on the challan. */
export function shortageRatePerPkgPaise(
  line: ShortageLineInput,
  source: ShortageSettings["rateSource"],
  challan: { hireAmount: Money; totalLoadedPkgs: number },
): number {
  if (source === "party_rate") return roundDiv(toPaise(line.freightAllocated), line.loadedPkgs);
  return roundDiv(toPaise(challan.hireAmount), challan.totalLoadedPkgs);
}

/** max(0, loaded − delivered − allowance) × rate per package; nothing when the setting is off. */
export function lineShortage(
  line: ShortageLineInput,
  settings: ShortageSettings,
  challan: { hireAmount: Money; totalLoadedPkgs: number },
): ShortageResult {
  if (!settings.enabled) return NO_SHORTAGE;
  if (line.deliveredPkgs === null || line.deliveredPkgs === undefined) return NO_SHORTAGE;
  const allowancePkgs = shortageAllowancePkgs(line.loadedPkgs, settings.allowancePct);
  const shortPkgs = Math.max(0, line.loadedPkgs - line.deliveredPkgs - allowancePkgs);
  const ratePerPkgPaise = shortageRatePerPkgPaise(line, settings.rateSource, challan);
  return { shortPkgs, allowancePkgs, ratePerPkgPaise, amountPaise: shortPkgs * ratePerPkgPaise };
}

// ---------- dates & status ----------
export interface PodDates {
  reportedAt: string | null;
  unloadedAt: string | null;
  podReceivedAt: string | null;
}

/** Reported ≤ unloaded ≤ POD received; a received POD needs the unloading date. */
export function podDateIssues(d: PodDates): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  const t = (v: string | null) => (v ? Date.parse(v) : null);
  const [r, u, p] = [t(d.reportedAt), t(d.unloadedAt), t(d.podReceivedAt)];
  if (r !== null && u !== null && u < r)
    out.push({ path: "unloadedAt", message: "Unloaded can't be before reported" });
  if (p !== null && u === null)
    out.push({ path: "unloadedAt", message: "Enter the unloading date before the POD received date" });
  if (p !== null && u !== null && p < u)
    out.push({ path: "podReceivedAt", message: "POD received can't be before unloading" });
  return out;
}

/** dispatched → pod_received when the POD date is set; clearing it goes back to dispatched. */
export function statusAfterPod(
  current: SettlementChallanStatus,
  podReceivedAt: string | null,
): SettlementChallanStatus {
  if (current === "draft" || current === "settled") return current;
  if (podReceivedAt) return "pod_received";
  return current === "pod_received" ? "dispatched" : current;
}

/** Why the challan can't be settled, or null. Payments are not required (owner decision). */
export function settleProblem(
  status: SettlementChallanStatus,
  podReceivedAt: string | null | undefined,
): string | null {
  if (status === "settled") return "This challan is already settled";
  if (status !== "pod_received" || !podReceivedAt)
    return "Record the POD received date before settling";
  return null;
}

// ---------- money ----------
export interface SettlementMoney {
  hireAmount: string;
  additions: string;
  deductions: string;
  grossCredit: string;
  tds: string;
  netPayable: string;
  paid: string;
  balance: string;
}

/**
 * The challan's totals (as v_challan_balance had them) after the POD-stage charges changed from
 * `before` to `after`. Paid / TDS come only from paid payments, so a challan with no payments
 * simply shows paid 0 and balance = net payable.
 */
export function settlementMoney(
  base: { hireAmount: Money; additions: Money; deductions: Money; tds: Money; paid: Money },
  before: readonly HireCharge[],
  after: readonly HireCharge[],
): SettlementMoney {
  const add =
    toPaise(base.additions) - sumChargesPaise(before, "add") + sumChargesPaise(after, "add");
  const ded =
    toPaise(base.deductions) - sumChargesPaise(before, "deduct") + sumChargesPaise(after, "deduct");
  const hire = toPaise(base.hireAmount);
  const tds = toPaise(base.tds);
  const paid = toPaise(base.paid);
  const net = hire + add - ded - tds;
  return {
    hireAmount: fromPaise(hire),
    additions: fromPaise(add),
    deductions: fromPaise(ded),
    grossCredit: fromPaise(hire + add),
    tds: fromPaise(tds),
    netPayable: fromPaise(net),
    paid: fromPaise(paid),
    balance: fromPaise(net - paid),
  };
}

/** Where a party-billable charge lands on a freight bill line. */
export function billColumnFor(code: string | null, label: string | null): "detention" | "other" {
  return /detention/i.test(`${code ?? ""} ${label ?? ""}`) ? "detention" : "other";
}

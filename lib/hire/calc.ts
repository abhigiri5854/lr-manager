// Hire (market truck) calculations — TIER1-MARKET-TRUCKS.md §4 with §9 decisions:
// TDS is manual (default 0, never auto-applied) and deducted on the BALANCE payment only;
// rate basis is TRIP or PER_TONNE only. Pure functions, no DB access.
import { fromPaise, mulMilli, toMilli, toPaise, type Money } from "./money";

export type RateBasis = "trip" | "per_tonne";
export type ChargeDirection = "add" | "deduct";
export type AllocationKind = "advance" | "balance" | "adjustment";

export interface HireCharge {
  direction: ChargeDirection;
  amount: Money;
}

export interface HirePayment {
  kind: AllocationKind;
  amount: Money;
}

const DAY_MS = 86_400_000;

function roundDiv(n: bigint, d: bigint): number {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const q = (abs + d / 2n) / d;
  return Number(neg ? -q : q);
}

function toTime(value: Date | string): number {
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`Invalid date: ${String(value)}`);
  return t;
}

/** TRIP → rate; PER_TONNE → rate × tonnes (tonnes to 3 dp). Returns paise. */
export function hireAmountPaise(basis: RateBasis, rate: Money, tonnes?: Money | null): number {
  const ratePaise = toPaise(rate);
  if (ratePaise < 0) throw new Error("Rate cannot be negative");
  if (basis === "trip") return ratePaise;
  if (basis === "per_tonne") return mulMilli(ratePaise, toMilli(tonnes));
  throw new Error(`Unknown rate basis: ${String(basis)}`);
}

/** Σ charges in one direction, in paise. */
export function sumChargesPaise(charges: readonly HireCharge[], direction: ChargeDirection): number {
  return charges.reduce((sum, c) => (c.direction === direction ? sum + toPaise(c.amount) : sum), 0);
}

/** round(base × percent / 100) to the paisa. Percent must be 0–100 (manual entry). */
export function tdsPaise(basePaise: number, percent: Money | null | undefined): number {
  const milli = toMilli(percent ?? 0);
  if (milli > 100_000) throw new Error("TDS % cannot exceed 100");
  return roundDiv(BigInt(basePaise) * BigInt(milli), 100_000n);
}

/** TDS on one payment allocation: only BALANCE carries TDS; advances/adjustments never do. */
export function tdsForAllocationPaise(
  kind: AllocationKind,
  basePaise: number,
  percent: Money | null | undefined,
): number {
  return kind === "balance" ? tdsPaise(basePaise, percent) : 0;
}

export interface ChallanCalcInput {
  basis: RateBasis;
  rate: Money;
  tonnes?: Money | null;
  charges?: readonly HireCharge[];
  /** Manual TDS % entered on the balance payment. Defaults to 0. */
  tdsPercent?: Money | null;
  /** Payment allocations (advance + balance, any mode incl. diesel). */
  payments?: readonly HirePayment[];
}

export interface ChallanCalc {
  hireAmount: string;
  additions: string;
  deductions: string;
  grossCredit: string;
  tdsBase: string;
  tdsPercent: string;
  tds: string;
  netPayable: string;
  paid: string;
  balance: string;
}

/** Full §4 challan breakdown; amounts as numeric(14,2) strings. */
export function calcChallan(input: ChallanCalcInput): ChallanCalc {
  const charges = input.charges ?? [];
  const hire = hireAmountPaise(input.basis, input.rate, input.tonnes);
  const additions = sumChargesPaise(charges, "add");
  const deductions = sumChargesPaise(charges, "deduct");
  const gross = hire + additions;
  const percentMilli = toMilli(input.tdsPercent ?? 0);
  const tds = tdsPaise(gross, input.tdsPercent ?? 0);
  const net = gross - deductions - tds;
  const paid = (input.payments ?? []).reduce((s, p) => s + toPaise(p.amount), 0);
  return {
    hireAmount: fromPaise(hire),
    additions: fromPaise(additions),
    deductions: fromPaise(deductions),
    grossCredit: fromPaise(gross),
    tdsBase: fromPaise(gross),
    tdsPercent: (percentMilli / 1000).toFixed(2),
    tds: fromPaise(tds),
    netPayable: fromPaise(net),
    paid: fromPaise(paid),
    balance: fromPaise(net - paid),
  };
}

export interface TdsHint {
  /** Suggested rate shown as a hint only — never pre-filled into the TDS input. */
  suggestedPercent: number;
  warning: string | null;
}

/**
 * PAN-type hint for the balance-payment TDS input (194C style): no/invalid PAN → 20,
 * individual/HUF (4th char P/H) → 1, others → 2; a transporter declaration on file → 0.
 */
export function tdsHint(pan: string | null | undefined, declarationOnFile: boolean): TdsHint {
  const p = (pan ?? "").trim().toUpperCase();
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(p)) {
    return { suggestedPercent: 20, warning: "No valid PAN on file" };
  }
  if (declarationOnFile) return { suggestedPercent: 0, warning: null };
  const suggestedPercent = p[3] === "P" || p[3] === "H" ? 1 : 2;
  return { suggestedPercent, warning: "No declaration on file" };
}

/** max(0, loaded − delivered − allowance) × rate_per_pkg, in paise. */
export function shortagePaise(
  loadedPkgs: number,
  deliveredPkgs: number,
  allowance: number,
  ratePerPkg: Money,
): number {
  const shortPkgs = Math.max(0, loadedPkgs - deliveredPkgs - allowance);
  return shortPkgs * toPaise(ratePerPkg);
}

/** Whole elapsed days between two instants (never negative). */
export function elapsedDays(from: Date | string, to: Date | string): number {
  return Math.max(0, Math.floor((toTime(to) - toTime(from)) / DAY_MS));
}

/** max(0, days(reported→unloaded) − free_days) × rate_per_day, in paise. */
export function detentionPaise(
  reportedAt: Date | string,
  unloadedAt: Date | string,
  freeDays: number,
  ratePerDay: Money,
): number {
  const days = Math.max(0, elapsedDays(reportedAt, unloadedAt) - freeDays);
  return days * toPaise(ratePerDay);
}

/** Fee (paise) if POD came in more than `allowedDays` after unloading, else 0. */
export function latePodFeePaise(
  unloadedAt: Date | string,
  podReceivedAt: Date | string | null | undefined,
  allowedDays: number,
  fee: Money,
): number {
  if (!podReceivedAt) return 0;
  return toTime(podReceivedAt) - toTime(unloadedAt) > allowedDays * DAY_MS ? toPaise(fee) : 0;
}

export interface TripMargin {
  revenue: string;
  cost: string;
  margin: string;
  /** margin / revenue × 100 to 2 dp; null when revenue is 0. */
  marginPercent: number | null;
}

/** revenue = LR freight + party-billable charges; cost = gross credit + own costs. */
export function tripMargin(input: {
  lrFreight: readonly Money[];
  partyCharges?: readonly Money[];
  grossCredit: Money;
  ownCosts?: readonly Money[];
}): TripMargin {
  const sum = (xs: readonly Money[] = []) => xs.reduce<number>((s, x) => s + toPaise(x), 0);
  const revenue = sum(input.lrFreight) + sum(input.partyCharges);
  const cost = toPaise(input.grossCredit) + sum(input.ownCosts);
  const margin = revenue - cost;
  return {
    revenue: fromPaise(revenue),
    cost: fromPaise(cost),
    margin: fromPaise(margin),
    marginPercent: revenue === 0 ? null : roundDiv(BigInt(margin) * 10_000n, BigInt(revenue)) / 100,
  };
}

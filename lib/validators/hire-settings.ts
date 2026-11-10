import { z } from "zod";
import { optional } from "./common";

// Tier-1 company settings for market-truck hiring (TIER1-MARKET-TRUCKS.md §7).
// Percentages are 0–100; money is rupees (numeric columns, not paise). Empty = not configured.

export const TDS_TIMINGS = [
  // Client decision (TIER1 §9 #2): TDS is deducted at the balance payment only, never on advances.
  { value: "balance", label: "At balance payment" },
] as const;
export const TDS_BASES = [
  { value: "gross_credit", label: "Gross amount credited" },
  { value: "net_payable", label: "Net payable after deductions" },
] as const;
export const SHORTAGE_RATE_SOURCES = [
  { value: "party_rate", label: "Rate charged to the party" },
  { value: "truck_rate", label: "Rate paid to the truck" },
] as const;

const pct = optional(z.number("Enter a number").min(0, "Can't be negative").max(100, "At most 100"));
const rupees = optional(z.number("Enter an amount").min(0, "Can't be negative").max(99999999999));
const whole = (max: number) =>
  optional(z.number("Enter a whole number").int("Whole number only").min(0, "Can't be negative").max(max));
const choice = <T extends readonly { value: string }[]>(opts: T) =>
  z.enum(opts.map((o) => o.value) as [T[number]["value"], ...T[number]["value"][]]);

export const hireSettingsFields = z.object({
  minMarginPct: pct,
  rateOutlierPct: pct,
  tdsSectionLabel: optional(z.string().trim().max(40)),
  tdsRateIndividualPct: pct,
  tdsRateOtherPct: pct,
  tdsRateNoPanPct: pct,
  tdsThreshold: rupees,
  tdsNilMaxVehicles: whole(1000),
  tdsTiming: choice(TDS_TIMINGS),
  tdsBase: choice(TDS_BASES),
  shortageAllowancePct: pct,
  shortageRateSource: optional(choice(SHORTAGE_RATE_SOURCES)),
  detentionFreeDays: whole(365),
  detentionRatePerDay: rupees,
  latePodDays: whole(365),
  latePodFee: rupees,
  cashWarningLimit: rupees,
  makerCheckerLimit: rupees,
  bankChangeCoolingHours: whole(720),
  ewbAlertHours: whole(168),
  ewbKmPerDay: z.number("Enter a whole number").int().min(1, "At least 1").max(2000),
  ewbOdcKmPerDay: z.number("Enter a whole number").int().min(1, "At least 1").max(2000),
});
export type HireSettingsInput = z.input<typeof hireSettingsFields>;
export type HireSettingsValues = z.output<typeof hireSettingsFields>;

/** Saved settings as the form shows them (numbers or null; version for conflict checks). */
export type HireSettings = {
  version: number;
  minMarginPct: number | null;
  rateOutlierPct: number | null;
  tdsSectionLabel: string | null;
  tdsRateIndividualPct: number | null;
  tdsRateOtherPct: number | null;
  tdsRateNoPanPct: number | null;
  tdsThreshold: number | null;
  tdsNilMaxVehicles: number | null;
  tdsTiming: string;
  tdsBase: string;
  shortageAllowancePct: number | null;
  shortageRateSource: string | null;
  detentionFreeDays: number | null;
  detentionRatePerDay: number | null;
  latePodDays: number | null;
  latePodFee: number | null;
  cashWarningLimit: number | null;
  makerCheckerLimit: number | null;
  bankChangeCoolingHours: number | null;
  ewbAlertHours: number | null;
  ewbKmPerDay: number;
  ewbOdcKmPerDay: number;
};

/** Field → column. */
export const HIRE_SETTING_COLUMNS: Record<keyof Omit<HireSettings, "version">, string> = {
  minMarginPct: "min_margin_pct",
  rateOutlierPct: "rate_outlier_pct",
  tdsSectionLabel: "tds_section_label",
  tdsRateIndividualPct: "tds_rate_individual_pct",
  tdsRateOtherPct: "tds_rate_other_pct",
  tdsRateNoPanPct: "tds_rate_no_pan_pct",
  tdsThreshold: "tds_threshold",
  tdsNilMaxVehicles: "tds_nil_max_vehicles",
  tdsTiming: "tds_timing",
  tdsBase: "tds_base",
  shortageAllowancePct: "shortage_allowance_pct",
  shortageRateSource: "shortage_rate_source",
  detentionFreeDays: "detention_free_days",
  detentionRatePerDay: "detention_rate_per_day",
  latePodDays: "late_pod_days",
  latePodFee: "late_pod_fee",
  cashWarningLimit: "cash_warning_limit",
  makerCheckerLimit: "maker_checker_limit",
  bankChangeCoolingHours: "bank_change_cooling_hours",
  ewbAlertHours: "ewb_alert_hours",
  ewbKmPerDay: "ewb_km_per_day",
  ewbOdcKmPerDay: "ewb_odc_km_per_day",
};

import { z } from "zod";
import { isoDate, optional, uuid, type RuleError } from "./common";

// Per-LR e-way bill details on a challan (challan_lrs.ewb_*). Empty = not set (null). Valid-upto is a
// date + time in India time ("yyyy-mm-ddThh:mm"); distance is whole km for the computed expiry.
export const ewbFields = {
  ewbNo: optional(z.string().trim().regex(/^[0-9]{12}$/, "E-way no. is 12 digits")),
  ewbDate: optional(isoDate),
  ewbValidUpto: optional(
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use date and time").refine(
      (s) => !Number.isNaN(Date.parse(`${s}:00+05:30`)),
      "Not a real date and time",
    ),
  ),
  ewbDistanceKm: optional(z.coerce.number("Enter km as a number").int("Whole km only").min(0).max(9999)),
};

export const challanLrEwbFields = z.object({ lrId: uuid, ...ewbFields });
export type ChallanLrEwbInput = z.input<typeof challanLrEwbFields>;
export type ChallanLrEwbValues = z.output<typeof challanLrEwbFields>;

type EwbValues = {
  ewbNo?: string | null;
  ewbDate?: string | null;
  ewbValidUpto?: string | null;
  ewbDistanceKm?: number | null;
};

/** Date, valid-upto or distance without an e-way no. is a mistake. */
export function ewbRuleErrors(v: EwbValues, prefix: string): RuleError[] {
  const other = [v.ewbDate, v.ewbValidUpto, v.ewbDistanceKm].some((x) => x !== undefined && x !== null);
  return other && !v.ewbNo ? [{ path: `${prefix}ewbNo`, message: "Enter the e-way no. first" }] : [];
}

/** "yyyy-mm-ddThh:mm" (India time) → ISO instant. */
export const isoFromIstLocal = (s: string): string => new Date(`${s}:00+05:30`).toISOString();

/** ISO instant → "yyyy-mm-ddThh:mm" in India time (for the form). */
export const istLocalFromIso = (iso: string | null | undefined): string =>
  iso ? new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16) : "";

import { z } from "zod";
import { optional } from "./common";

// POD settlement inputs (TIER1-MARKET-TRUCKS.md §6 screen 3). Dates: "yyyy-mm-dd" (India midnight) or
// an ISO date-time; left out = unchanged, null / "" = cleared. Money is rupees (numeric(14,2)).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID, "Not a valid id");

const toInstant = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+05:30` : v);
const when = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(toInstant(v))), "Not a valid date")
  .transform((v) => new Date(toInstant(v)).toISOString());

const rupees = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), "Enter an amount in rupees (up to 2 decimals)");

const reason = z.string().trim().min(3, "Give a reason").max(300);

export const challanPodFields = z.object({
  reportedAt: optional(when),
  unloadedAt: optional(when),
  podReceivedAt: optional(when),
  lrs: z
    .array(
      z.object({
        lrId: uuid,
        /** Left out = unchanged; null = not counted yet. */
        deliveredPkgs: z.number().int("Whole packages only").min(0).nullable().optional(),
        condition: z.enum(["good", "short", "damaged"]).optional(),
        remarks: optional(z.string().trim().max(500)),
        /** POD files from uploadPodFile for this LR; replaces the LR POD's files when given. */
        documentUrls: z.array(z.string().min(1).max(500)).max(10).optional(),
      }),
    )
    .max(200)
    .default([]),
});
export type ChallanPodInput = z.input<typeof challanPodFields>;
export type ChallanPodValues = z.output<typeof challanPodFields>;

export const challanPodChargesFields = z.object({
  /** Upserts: with id = edit that manual line, without = new line. Lines not listed stay as they are. */
  charges: z
    .array(
      z.object({
        id: uuid.optional(),
        chargeTypeId: uuid,
        /** Required for a party-billable line unless the challan carries one LR. */
        lrId: optional(uuid),
        /** Default: the charge type's direction. */
        direction: z.enum(["add", "deduct"]).optional(),
        /** To / from the truck. 0 = party-only line. */
        amount: rupees.default("0"),
        /** Blank by default; only a filled amount becomes a billable line. */
        partyAmount: optional(rupees),
        note: optional(z.string().trim().max(300)),
      }),
    )
    .max(100)
    .default([]),
  /** Manual lines to cancel (needs record.cancel). */
  remove: z.array(uuid).max(100).default([]),
  /** Late-POD fee: left out = unchanged, null = back to the auto amount, set = override with a reason. */
  latePodOverride: z.object({ amount: rupees, reason }).nullable().optional(),
});
export type ChallanPodChargesInput = z.input<typeof challanPodChargesFields>;
export type ChallanPodChargesValues = z.output<typeof challanPodChargesFields>;

export const reopenChallanFields = z.object({ reason });
export type ReopenChallanInput = z.input<typeof reopenChallanFields>;

// Truck payment (pay truck, TIER1-MARKET-TRUCKS.md §6 screen 4) — shared by the form and lib/data.
import { z } from "zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const PCT_RE = /^\d{1,3}(\.\d{1,3})?$/;

export const TRUCK_PAYMENT_MODES = ["bank", "upi", "cash", "cheque", "diesel"] as const;

const uuid = (message: string) => z.string().trim().regex(UUID_RE, message);
const optUuid = z
  .union([z.string().trim().regex(UUID_RE), z.literal(""), z.null()])
  .optional()
  .transform((v) => v || null);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);
const date = (message: string) => z.string().trim().regex(DATE_RE, message);
const optDate = z
  .union([z.string().trim().regex(DATE_RE, "Enter a date"), z.literal(""), z.null()])
  .optional()
  .transform((v) => v || null);
const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => MONEY_RE.test(v), "Enter an amount like 15000 or 15000.50");
const tdsPercent = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === undefined || v === null || v === "" ? "0" : String(v).trim()))
  .refine((v) => PCT_RE.test(v) && Number(v) <= 100, "TDS % must be between 0 and 100");

export const truckPaymentAllocationFields = z.object({
  challanId: uuid("Pick a challan"),
  kind: z.enum(["advance", "balance"]),
  /** What this line settles on the challan (cash + TDS), rupees. */
  amount: money,
});

export const truckPaymentFields = z
  .object({
    branchId: uuid("Pick a branch"),
    paidOn: date("Enter the payment date"),
    payeePartyId: uuid("Pick who is paid"),
    mode: z.enum(TRUCK_PAYMENT_MODES),
    pumpId: optUuid,
    bankAccountId: optUuid,
    upiId: optText(100),
    upiQrUrl: optText(500),
    refNo: optText(50),
    chequeDate: optDate,
    /** Manual, default 0; only allowed with a balance line (§9 decisions 1–2). */
    tdsPercent,
    narration: optText(500),
    allocations: z
      .array(truckPaymentAllocationFields)
      .min(1, "Allocate the payment to at least one challan")
      .max(100, "At most 100 challans per payment"),
    confirmDuplicate: z.boolean().default(false),
    podOverrideReason: optText(500),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "diesel" && !v.pumpId)
      ctx.addIssue({ code: "custom", path: ["pumpId"], message: "Pick the pump for a diesel advance" });
    if (v.mode === "cheque") {
      if (!v.refNo) ctx.addIssue({ code: "custom", path: ["refNo"], message: "Enter the cheque number" });
      if (!v.chequeDate)
        ctx.addIssue({ code: "custom", path: ["chequeDate"], message: "Enter the cheque date" });
    }
  });

export type TruckPaymentInput = z.input<typeof truckPaymentFields>;
export type TruckPaymentValues = z.output<typeof truckPaymentFields>;

export const truckPaymentSubmitFields = z.object({
  confirmDuplicate: z.boolean().default(false),
  podOverrideReason: optText(500),
});
export type TruckPaymentSubmitInput = z.input<typeof truckPaymentSubmitFields>;

export const truckPaymentApproveFields = z.object({
  podOverrideReason: optText(500),
});
export type TruckPaymentApproveInput = z.input<typeof truckPaymentApproveFields>;

export const truckPaymentPaidFields = z.object({
  /** Defaults to today (India). */
  paidOn: optDate,
  /** UTR for bank / UPI (required there); cheque / slip no. otherwise. */
  refNo: optText(50),
});
export type TruckPaymentPaidInput = z.input<typeof truckPaymentPaidFields>;

export const truckPaymentReverseFields = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Enter why the payment is reversed")
    .max(500),
});
export type TruckPaymentReverseInput = z.input<typeof truckPaymentReverseFields>;

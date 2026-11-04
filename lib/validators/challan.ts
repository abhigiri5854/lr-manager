import { z } from "zod";
import { isoDate, optional, optionalText, uuid, type RuleError } from "./common";

// Challan create / edit (TIER1-MARKET-TRUCKS.md §6 screen 1, §9: TRIP / PER_TONNE, Pay to OWNER / BROKER).
const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 18500 or 18500.50");
const tonnes = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter tonnes like 12.5");
const kg = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter weight in kg");

export const challanLrFields = z.object({
  lrId: uuid,
  loadedPkgs: z.coerce.number().int("Whole packages only").min(1, "At least 1 package"),
  loadedWt: optional(kg),
});

export const challanChargeFields = z.object({
  chargeTypeId: uuid,
  amount: money,
  note: optionalText(200),
});

export const challanFields = z.object({
  branchId: uuid,
  challanDate: isoDate,
  source: optionalText(200),
  destination: optionalText(200),
  vehicleId: optional(uuid),
  driverId: optional(uuid),
  brokerId: optional(uuid),
  payeeKind: z.enum(["owner", "broker"]),
  rateBasis: z.enum(["trip", "per_tonne"]),
  rate: money,
  qtyTonnes: optional(tonnes),
  remarks: optionalText(500),
  lrs: z.array(challanLrFields).min(1, "Add at least one LR"),
  charges: z.array(challanChargeFields),
  /** "draft" keeps it editable; "dispatch" needs a vehicle, a payee and a rate. */
  action: z.enum(["draft", "dispatch"]),
});

export type ChallanInput = z.input<typeof challanFields>;
export type ChallanValues = z.output<typeof challanFields>;

/** Rules that depend on several fields; shared by the form (before sending) and the data layer. */
export function challanRuleErrors(v: ChallanValues): RuleError[] {
  const out: RuleError[] = [];
  const ids = v.lrs.map((l) => l.lrId);
  ids.forEach((id, i) => {
    if (ids.indexOf(id) !== i) out.push({ path: `lrs.${i}.lrId`, message: "This LR is added twice" });
  });
  if (v.rateBasis === "per_tonne" && !v.qtyTonnes)
    out.push({ path: "qtyTonnes", message: "Tonnes are needed for a per-tonne rate" });
  if (v.payeeKind === "broker" && !v.brokerId)
    out.push({ path: "brokerId", message: "Pick the broker you pay" });
  if (v.action === "dispatch") {
    if (!v.vehicleId) out.push({ path: "vehicleId", message: "Pick the vehicle before dispatching" });
    if (Number(v.rate) <= 0) out.push({ path: "rate", message: "Enter the hire rate before dispatching" });
  }
  return out;
}

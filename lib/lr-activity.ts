import { formatDate, formatRupees } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";

const FIELD_LABELS: Record<string, string> = {
  lrDate: "LR date",
  fromPlace: "From",
  toPlace: "To",
  risk: "Risk",
  consignorId: "Consignor",
  consigneeId: "Consignee",
  billedToId: "Billed to",
  gstPaidBy: "GST paid by",
  paymentMode: "Payment mode",
  chargedAs: "Charged as",
  ratePaise: "Rate",
  truckId: "Truck",
  driverMobile: "Driver mobile",
  lrInvoices: "Goods invoices",
  items: "Goods",
  charges: "Freight & charges",
  remarks: "Remarks",
  bookedAt: "Booked",
  dispatchedAt: "Dispatched",
  deliveredAt: "Delivered",
};

/** Bookkeeping fields nobody needs to read about. */
const HIDDEN = new Set(["snapshot", "lrNo", "cancelledAt", "cancelReason"]);

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number" && field.endsWith("Paise")) return formatRupees(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) return formatDate(value);
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

/** One line of the Activity list: what happened, e.g. "Changed To: Motihari → Gaighat". */
export function describeAudit(entry: AuditEntry, cancelReason?: string): string {
  if (entry.action === "create") return "LR created";
  if (entry.action === "cancel")
    return cancelReason ? `LR cancelled (${cancelReason})` : "LR cancelled";
  const parts = entry.changes
    .filter((c) => !HIDDEN.has(c.field))
    .map((c) => {
      const label = FIELD_LABELS[c.field] ?? c.field;
      const o = show(c.field, c.old);
      const n = show(c.field, c.new);
      // Nested values (items, invoices, charges) are too long to print.
      return o || n ? `${label}: ${o} → ${n}` : `${label} changed`;
    });
  return parts.length ? `Changed ${parts.join("; ")}` : "Saved without changes";
}

// Who can do what — the single source of truth, from the table "What each role can do" in
// design/screens/Users.dc.html. lib/data checks every write against this map (assertCan);
// screens may use can() to hide buttons, but the data layer is what enforces it.
import type { Role } from "@/lib/types";

export type Action =
  /** Create / edit LR (book, dispatch). */
  | "lr.edit"
  /** Tax invoices: create, edit, finalise. */
  | "invoice.edit"
  /** Freight bills & payments: create, edit, finalise. */
  | "bill.edit"
  /** Delete or cancel any record (LR, invoice, bill, payment, POD, party, truck, driver). */
  | "record.cancel"
  /** Company profile & users (incl. logo/signature, roles, inviting drivers to the app). */
  | "company.manage"
  /** Smart import. */
  | "import.run"
  /** Upload POD photo / record delivery on any LR. */
  | "pod.upload"
  /** Upload POD photo / record delivery only on the driver's own trips. */
  | "pod.upload_own"
  /** See freight amounts. */
  | "freight.view"
  /**
   * Add / edit parties, trucks, drivers and items. Not a row in the design table: given to
   * every office role, because creating LRs and invoices adds them on the fly.
   */
  | "master.edit";

export const PERMISSIONS: Record<Role, readonly Action[]> = {
  owner: [
    "lr.edit",
    "invoice.edit",
    "bill.edit",
    "record.cancel",
    "company.manage",
    "import.run",
    "pod.upload",
    "freight.view",
    "master.edit",
  ],
  accountant: ["invoice.edit", "bill.edit", "import.run", "freight.view", "master.edit"],
  booking_staff: [
    "lr.edit",
    "invoice.edit",
    "import.run",
    "pod.upload",
    "freight.view",
    "master.edit",
  ],
  // Drivers only use the phone app (My trips).
  driver: ["pod.upload_own"],
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return role ? PERMISSIONS[role].includes(action) : false;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  accountant: "Accountant",
  booking_staff: "Booking staff",
  driver: "Driver",
};

/** Ends "Your role (Accountant) can't …". */
export const ACTION_LABEL: Record<Action, string> = {
  "lr.edit": "create or edit LRs",
  "invoice.edit": "create or edit tax invoices",
  "bill.edit": "create or edit freight bills and payments",
  "record.cancel": "cancel records",
  "company.manage": "change the company profile or users",
  "import.run": "use Smart import",
  "pod.upload": "record POD for this LR",
  "pod.upload_own": "record POD for this LR",
  "freight.view": "see freight amounts",
  "master.edit": "add or edit parties, trucks, drivers and items",
};

export function deniedMessage(role: Role | null | undefined, action: Action): string {
  return role
    ? `Your role (${ROLE_LABEL[role]}) can't ${ACTION_LABEL[action]}.`
    : "You're not a member of this company.";
}

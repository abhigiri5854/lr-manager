import type { TruckPartyRole, TruckPaymentMode, TruckPaymentStatus } from "@/lib/types";

export const truckPartyRoleLabel: Record<TruckPartyRole, string> = {
  owner: "Owner",
  broker: "Broker",
  both: "Owner & broker",
};

export const paymentModeLabel: Record<TruckPaymentMode, string> = {
  bank: "Bank transfer",
  upi: "UPI",
  cash: "Cash",
  cheque: "Cheque",
  diesel: "Diesel (pump)",
};

export const paymentStatusLabel: Record<TruckPaymentStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  paid: "Paid",
  reversed: "Reversed",
};

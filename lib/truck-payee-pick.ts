import type { TruckParty } from "@/lib/types";

/** What the pay-truck form needs to know about a payee (never the account number). */
export type PayeePick = {
  id: string;
  name: string;
  mobile: string | null;
  pan: string | null;
  verified: boolean;
  blacklisted: boolean;
  hasBankDetails: boolean;
  hasUpi: boolean;
};

export const toPayeePick = (p: TruckParty): PayeePick => ({
  id: p.id,
  name: p.name,
  mobile: p.mobile,
  pan: p.pan,
  verified: p.verified,
  blacklisted: p.status === "blacklisted",
  hasBankDetails: !!(p.accountNo && p.ifsc),
  hasUpi: !!(p.upiId || p.upiQrUrl),
});

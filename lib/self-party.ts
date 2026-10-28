// The "self" party: one per company, standing for the company itself so it can be consignor,
// consignee or billed-to on an LR (e.g. goods invoices we issue). Its details always come from
// the Company profile; it is never edited or cancelled from Parties.
import type { Company, Party } from "@/lib/types";

/** Party fields that mirror the Company profile. */
export type SelfPartyFields = Pick<
  Party,
  "name" | "place" | "gstin" | "pan" | "phone" | "address" | "stateCode" | "pincode"
>;

/** Last 6-digit PIN code in the office address ("… Patna - 800026" → "800026"). */
function pincodeIn(address: string): string | null {
  const all = address.match(/\b[1-9]\d{5}\b/g);
  return all ? all[all.length - 1] : null;
}

export function selfPartyFields(c: Company): SelfPartyFields {
  return {
    name: c.name,
    place: c.city || null,
    gstin: c.gstin,
    pan: c.pan,
    phone: c.mobile1,
    address: c.office || null,
    stateCode: c.gstin.slice(0, 2),
    pincode: pincodeIn(c.office),
  };
}

export const SELF_SUFFIX = " (our company)";

/** Name as shown in lists and pickers: "ACM LOGISTICS (our company)". */
export function partyLabel(p: { name: string; isSelf?: boolean }): string {
  return p.isSelf ? `${p.name}${SELF_SUFFIX}` : p.name;
}

export const SELF_PARTY_LOCKED =
  "This is your own company. Its details come from Company profile and can't be changed or cancelled here.";

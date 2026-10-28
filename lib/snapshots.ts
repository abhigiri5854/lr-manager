import type { Company, CompanySnapshot, Party, PartySnapshot } from "@/lib/types";

/** Party details frozen onto a finalised document. */
export function partySnapshot(p: Party): PartySnapshot {
  return {
    id: p.id,
    name: p.name,
    place: p.place,
    gstin: p.gstin,
    pan: p.pan,
    phone: p.phone,
    address: p.address,
    stateCode: p.stateCode,
    pincode: p.pincode,
  };
}

/** Company details frozen onto a finalised document. */
export function companySnapshot(c: Company): CompanySnapshot {
  const { createdAt, updatedAt, cancelledAt, version, nextLrNo, ...rest } = c;
  void [createdAt, updatedAt, cancelledAt, version, nextLrNo];
  return structuredClone(rest);
}

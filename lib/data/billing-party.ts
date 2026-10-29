import type { Lr, PartySnapshot } from "@/lib/types";
import { db, findById } from "./_store";

export type BillingParty = {
  id: string;
  name: string;
  place: string | null;
  gstin: string | null;
  /** No "billed to" on the LR, so the consignee pays. */
  sameAsConsignee: boolean;
};

/**
 * Who an LR is billed to: its billed-to party, else the consignee. A booked LR uses the party
 * details it was booked with. Shared by LR detail and freight bills so both agree.
 */
export function billingPartyFor(
  lr: Pick<Lr, "companyId" | "billedToId" | "consigneeId" | "snapshot">,
): BillingParty | null {
  return billingPartyOf(lr, (id) => findById(db.parties, lr.companyId, id));
}

/** Same, with the live party records supplied by the caller (the database reads them itself). */
export function billingPartyOf(
  lr: Pick<Lr, "billedToId" | "consigneeId" | "snapshot">,
  live: (id: string) => PartySnapshot | undefined,
): BillingParty | null {
  const sameAsConsignee = lr.billedToId === null;
  const id = lr.billedToId ?? lr.consigneeId;
  if (!id) return null;
  const snap: PartySnapshot | null | undefined = sameAsConsignee
    ? lr.snapshot?.consignee
    : lr.snapshot?.billedTo;
  const p = snap ?? live(id);
  return p ? { id, name: p.name, place: p.place, gstin: p.gstin, sameAsConsignee } : null;
}

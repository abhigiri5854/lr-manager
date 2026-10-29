// Server-side loaders for the freight bill form (used by the pages and by actions.ts).
import { toBillLrRow, type BillLrRow } from "@/lib/bill-form";
import { listUnbilledLrs } from "@/lib/data/bills";
import { getCompany } from "@/lib/data/companies";
import { getLrById } from "@/lib/data/lrs";
import { getPartyById } from "@/lib/data/parties";
import type { FreightBillView } from "@/lib/types";

export type BillPartyData = {
  rows: BillLrRow[];
  /** SGST + CGST (party in the company's state) or IGST. */
  intraState: boolean;
};

/**
 * The LRs offered for one party: every unbilled booked LR billed to it, plus (when editing a
 * draft) the LRs already on that draft.
 */
export async function loadBillParty(
  companyId: string,
  partyId: string,
  bill?: FreightBillView | null,
): Promise<BillPartyData> {
  const [unbilled, party, company, onBill] = await Promise.all([
    listUnbilledLrs(companyId, partyId),
    getPartyById(companyId, partyId),
    getCompany(companyId),
    Promise.all(
      (bill && bill.partyId === partyId ? bill.lines : []).map((l) => getLrById(companyId, l.lrId)),
    ),
  ]);
  const seen = new Set<string>();
  const rows = [...onBill.filter((x) => x !== null), ...unbilled]
    .filter((lr) => !seen.has(lr.id) && !!seen.add(lr.id))
    .map(toBillLrRow);
  const partyState = party?.stateCode ?? party?.gstin?.slice(0, 2) ?? null;
  return { rows, intraState: !!company && partyState === company.gstin.slice(0, 2) };
}

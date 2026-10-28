import { getTaxInvoiceById } from "@/lib/data/invoices";
import { getPartyById } from "@/lib/data/parties";
import { getTruckById } from "@/lib/data/trucks";
import type { LrFormValues, PartyOption, TruckOption } from "@/lib/lr-form";

// Server-side loading shared by /lr/new and /lr/[id]/edit.

async function partyOption(companyId: string, id: string | null): Promise<PartyOption | null> {
  const p = id ? await getPartyById(companyId, id) : null;
  return p
    ? {
        id: p.id,
        name: p.name,
        place: p.place,
        gstin: p.gstin,
        phone: p.phone,
        address: p.address,
        stateCode: p.stateCode,
      }
    : null;
}

/** Details of the parties and truck already on the form, to show under the pickers. */
export async function loadPicked(companyId: string, v: LrFormValues) {
  const [consignor, consignee, billedTo, truck] = await Promise.all([
    partyOption(companyId, v.consignorId),
    partyOption(companyId, v.consigneeId),
    partyOption(companyId, v.billedToSame ? null : v.billedToId),
    v.truckId ? getTruckById(companyId, v.truckId) : null,
  ]);
  const truckOption: TruckOption | null = truck
    ? { id: truck.id, number: truck.number, driverMobile: truck.driverMobile, lastLrNo: null }
    : null;
  return { consignor, consignee, billedTo, truck: truckOption };
}

/** The tax invoice the LR's goods came from, if any (for the "Linked to tax invoice" strip). */
export async function loadLinkedInvoice(companyId: string, v: LrFormValues) {
  const id = v.invoices.find((r) => r.taxInvoiceId)?.taxInvoiceId;
  const inv = id ? await getTaxInvoiceById(companyId, id) : null;
  return inv ? { id: inv.id, invoiceNo: inv.invoiceNo ?? "draft" } : null;
}

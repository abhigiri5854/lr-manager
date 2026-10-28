import type { TaxInvoice, TaxInvoiceStatus } from "@/lib/types";

/** The one place a tax invoice's displayed status is worked out. */
export function invoiceStatus(inv: Pick<TaxInvoice, "status" | "cancelledAt">): TaxInvoiceStatus {
  return inv.cancelledAt ? "cancelled" : inv.status;
}

/** Imported from a consignor: the seller is a party, not this company. */
export function isImportedInvoice(inv: Pick<TaxInvoice, "sellerPartyId">): boolean {
  return inv.sellerPartyId !== null;
}

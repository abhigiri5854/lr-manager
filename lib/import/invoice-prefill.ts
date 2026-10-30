// A read invoice → the values the Tax invoice form opens with, plus which fields to show orange.
// Nothing is created here: parties and trucks that aren't in the system yet become "pending"
// records with temporary ids ("new:billTo"); the server creates them when the user saves.
import { formatPaise } from "@/lib/format";
import { emptyLine, type InvoiceFormValues } from "@/lib/invoice-form";
import { isoToIstInput, rowKey, type PartyOption, type TruckOption } from "@/lib/lr-form";
import {
  isValidMobile,
  isValidVehicleNo,
  normaliseMobile,
  normaliseVehicleNo,
} from "@/lib/validators/common";
import type { PartyInput } from "@/lib/validators/party";
import type { ReadInvoice, ReadParty } from "./types";

export const PENDING_PREFIX = "new:";

/** True for the temporary id of a record that will be created on Save. */
export const isPending = (id: string | null | undefined): boolean =>
  Boolean(id?.startsWith(PENDING_PREFIX));

export type ImportFlag = "low-confidence" | "new-record";

/** Records to create when the user saves (token → details). */
export type PendingRecords = {
  parties: Record<string, PartyInput>;
  trucks: Record<string, { number: string }>;
};

/** What the data layer can tell us about records already in the company. */
export type PrefillLookups = {
  partyByGstin(gstin: string): PartyOption | null;
  partyByName(name: string): PartyOption | null;
  truckByNumber(number: string): TruckOption | null;
  itemByCode(code: string): ItemMatch | null;
  /** Saved item with this HSN, or (failing that) this name. */
  itemByHsnOrName(hsn: string | null, description: string): ItemMatch | null;
  /** The seller's remembered fix for a wrong reading of `field` (see ./corrections.ts), or null. */
  correction(sellerGstin: string, field: string, wrong: string): string | null;
};

/** A saved item: what its master record can fill into an empty invoice row. */
export type ItemMatch = {
  id: string;
  hsn: string | null;
  uom: string | null;
  gstRateBp: number | null;
};

export type InvoicePrefill = {
  initial: InvoiceFormValues;
  /** The consignor who issued the invoice. `partyId` is a pending token when they are new. */
  seller: { name: string; gstin: string | null; state: string | null; partyId: string };
  /** Form field path → why it is orange. */
  flags: Record<string, ImportFlag>;
  pending: PendingRecords;
};

export function invoicePrefill(
  inv: ReadInvoice,
  lowConfidence: string[],
  lookups: PrefillLookups,
): InvoicePrefill {
  const flags: Record<string, ImportFlag> = {};
  const pending: PendingRecords = { parties: {}, trucks: {} };

  function resolveParty(p: ReadParty, token: string, field: string): PartyOption {
    const found = (p.gstin ? lookups.partyByGstin(p.gstin) : null) ?? lookups.partyByName(p.name);
    if (found) {
      // Saved details win; only what the saved party lacks is taken from the invoice, to check.
      const filled = { ...found };
      let touched = false;
      const take = <K extends "address" | "phone" | "stateCode" | "place">(k: K, read: string | null) => {
        if (!filled[k] && read) {
          filled[k] = read as never;
          touched = true;
        }
      };
      take("address", p.address);
      take("phone", p.phone);
      take("place", p.place);
      take("stateCode", p.stateCode ?? p.gstin?.slice(0, 2) ?? null);
      if (touched) flags[field] = "low-confidence";
      return filled;
    }
    const id = `${PENDING_PREFIX}${token}`;
    pending.parties[id] = {
      name: p.name,
      place: p.place,
      gstin: p.gstin,
      pan: p.pan,
      phone: p.phone,
      address: p.address,
      stateCode: p.stateCode,
      pincode: p.pincode,
      source: "invoice_scan",
    };
    flags[field] = "new-record";
    return {
      id,
      name: p.name,
      place: p.place,
      gstin: p.gstin,
      phone: p.phone,
      address: p.address,
      stateCode: p.stateCode ?? p.gstin?.slice(0, 2) ?? null,
      isSelf: false,
    };
  }

  const sellerParty = resolveParty(inv.seller, "seller", "seller");
  const billTo = resolveParty(inv.billTo, "billTo", "billTo");
  const shipTo = inv.shipTo ? resolveParty(inv.shipTo, "shipTo", "shipTo") : null;

  // Truck: a valid number matched to a saved truck, or a pending new one.
  let truck: TruckOption | null = null;
  const vehicle = inv.vehicleNo ? normaliseVehicleNo(inv.vehicleNo) : null;
  if (vehicle && isValidVehicleNo(vehicle)) {
    truck = lookups.truckByNumber(vehicle);
    if (!truck) {
      const id = `${PENDING_PREFIX}truck`;
      pending.trucks[id] = { number: vehicle };
      truck = {
        id,
        number: vehicle,
        driverMobile:
          inv.driverMobile && isValidMobile(inv.driverMobile)
            ? normaliseMobile(inv.driverMobile)
            : null,
        lastLrNo: null,
      };
      flags.truck = "new-record";
    }
  } else if (inv.vehicleNo) {
    flags.truck = "low-confidence";
  }

  let driverMobile =
    inv.driverMobile && isValidMobile(inv.driverMobile) ? normaliseMobile(inv.driverMobile) : "";
  if (inv.driverMobile && !driverMobile) flags.driverMobile = "low-confidence";
  // Nothing typed or read: use the driver saved on the matched truck, marked to check.
  if (!driverMobile && truck?.driverMobile && !isPending(truck.id)) {
    driverMobile = truck.driverMobile;
    flags.driverMobile = "low-confidence";
  }

  // Seller memory: a value the reader got wrong before for this seller is replaced, marked "check".
  const sellerGstin = inv.seller.gstin;
  const remembered = (field: string, value: string, flagPath = field): string => {
    const fixed = sellerGstin && value ? lookups.correction(sellerGstin, field, value) : null;
    if (fixed === null) return value;
    flags[flagPath] = "low-confidence";
    return fixed;
  };
  const invoiceNo = remembered("invoiceNo", inv.invoiceNo);

  const lines = inv.lines.map((l0, i) => {
    const path = (f: string) => `lines.${i}.${f}`;
    const l = {
      ...l0,
      description: remembered("description", l0.description, path("description")),
      hsn: l0.hsn ? remembered("hsn", l0.hsn, path("hsn")) : null,
      uom: l0.uom ? remembered("uom", l0.uom, path("uom")) : null,
      gstRateBp: Number(remembered("gstRateBp", String(l0.gstRateBp), path("gstRateBp"))) || l0.gstRateBp,
    };
    const byCode = l.itemCode ? lookups.itemByCode(l.itemCode) : null;
    const known = byCode ?? lookups.itemByHsnOrName(l.hsn, l.description);
    // An item code we've never seen: the line is kept, but check it.
    if (l.itemCode && !byCode && !known) flags[`lines.${i}.description`] = "new-record";
    // Only empty cells are filled from the saved item; each one filled is marked "check".
    const fill = (field: string, read: string | null, saved: string | null): string => {
      if (read) return read;
      if (!saved) return "";
      flags[`lines.${i}.${field}`] = "low-confidence";
      return saved;
    };
    // The reader always supplies a rate; it is only "empty" when it fell back to the 18% default.
    const rateGiven = !lowConfidence.includes(`lines.${i}.gstRateBp`);
    let gstRateBp = String(l.gstRateBp);
    if (!rateGiven && known?.gstRateBp != null) {
      gstRateBp = String(known.gstRateBp);
      flags[`lines.${i}.gstRateBp`] = "low-confidence";
    }
    return {
      ...emptyLine(),
      key: rowKey(),
      itemId: known?.id ?? null,
      itemCode: l.itemCode ?? "",
      description: l.description,
      hsn: fill("hsn", l.hsn, known?.hsn ?? null),
      uom: fill("uom", l.uom, known?.uom ?? null),
      qty: l.qty,
      rate: formatPaise(l.ratePaise),
      discount: l.discountPaise ? formatPaise(l.discountPaise) : "",
      gstRateBp,
    };
  });

  // What the reader itself wasn't sure about (never hides a "new record" flag).
  for (const path of lowConfidence) if (!flags[path]) flags[path] = "low-confidence";

  return {
    initial: {
      invoiceNo,
      invoiceAt: inv.invoiceAt ? isoToIstInput(inv.invoiceAt) : "",
      customerRef: inv.customerRef ?? "",
      customerRefDate: inv.customerRefDate ?? "",
      soNo: inv.soNo ?? "",
      soDate: inv.soDate ?? "",
      doNo: inv.doNo ?? "",
      sapRef: inv.sapRef ?? "",
      billTo,
      shipSame: !shipTo,
      shipTo,
      placeOfSupply: "",
      transporterName: inv.transporterName ?? "",
      truck,
      driverMobile,
      shipFrom: inv.shipFrom ?? "",
      incoterm: inv.incoterm ?? "",
      lines: lines.length ? lines : [emptyLine()],
    },
    seller: {
      name: sellerParty.name,
      gstin: sellerParty.gstin,
      state: sellerParty.stateCode ?? sellerParty.gstin?.slice(0, 2) ?? null,
      partyId: sellerParty.id,
    },
    flags,
    pending,
  };
}

// Freight bill form (FreightBill.dc.html): the LR rows offered for billing, the editable money
// fields, live totals and the step from form values to the validated input. Pure, no data access.
import { formatPaise, parseRupees } from "@/lib/format";
import { computeFreightGst } from "@/lib/tax";
import type { FreightBillView, LrView } from "@/lib/types";
import type { FreightBillInput } from "@/lib/validators/bill";

/** One LR the bill form can tick. Plain data so it crosses the server → client boundary. */
export type BillLrRow = {
  lrId: string;
  lrNo: string;
  lrDate: string | null;
  invoiceNos: string;
  consignee: string;
  route: string;
  truck: string;
  podReceived: boolean;
  /** Amounts on the LR, used to prefill the line (null = not entered on the LR). */
  freightPaise: number | null;
  detentionPaise: number;
  otherPaise: number;
  advancePaise: number;
};

export function toBillLrRow(lr: LrView): BillLrRow {
  const c = lr.charges;
  return {
    lrId: lr.id,
    lrNo: lr.lrNo,
    lrDate: lr.lrDate,
    invoiceNos: lr.lrInvoices.map((i) => i.invoiceNo).join(", "),
    consignee: lr.consigneeName ?? "",
    route: [lr.fromPlace, lr.toPlace].filter(Boolean).join(" → "),
    truck: lr.truckNumber ?? "",
    podReceived: !!lr.podReceivedAt,
    freightPaise: c.freight,
    detentionPaise: c.detention ?? 0,
    // Packing, CN, loading, unloading and "other" are all billed as other charges.
    otherPaise:
      (c.packing ?? 0) + (c.cnCharge ?? 0) + (c.loading ?? 0) + (c.unloading ?? 0) + (c.other ?? 0),
    advancePaise: c.advance ?? 0,
  };
}

/** Editable text for one LR line. */
export type BillLineValues = {
  ticked: boolean;
  freight: string;
  detention: string;
  other: string;
  advance: string;
};

const money = (paise: number | null) => (paise === null ? "" : formatPaise(paise));

export const lineFromRow = (r: BillLrRow, ticked = false): BillLineValues => ({
  ticked,
  freight: money(r.freightPaise),
  detention: r.detentionPaise ? money(r.detentionPaise) : "",
  other: r.otherPaise ? money(r.otherPaise) : "",
  advance: r.advancePaise ? money(r.advancePaise) : "",
});

export type BillFormValues = {
  partyId: string;
  billDate: string;
  gstMode: "reverse_charge" | "forward_charge";
  /** LR-date filter for the table (display only, not saved). */
  from: string;
  to: string;
  /** Keyed by lrId. */
  lines: Record<string, BillLineValues>;
};

export type BillFormErrors = Record<string, string>;

/** Form values of a saved bill (its LRs ticked, amounts as saved). */
export function billToFormValues(bill: FreightBillView): BillFormValues {
  return {
    partyId: bill.partyId,
    billDate: bill.billDate,
    gstMode: bill.gstMode,
    from: "",
    to: "",
    lines: Object.fromEntries(
      bill.lines.map((l) => [
        l.lrId,
        {
          ticked: true,
          freight: money(l.freightPaise),
          detention: l.detentionPaise ? money(l.detentionPaise) : "",
          other: l.otherPaise ? money(l.otherPaise) : "",
          advance: l.advancePaise ? money(l.advancePaise) : "",
        },
      ]),
    ),
  };
}

/** Text → paise; empty = 0; null when it isn't an amount. */
const amount = (text: string): number | null => {
  const v = parseRupees(text);
  return v === undefined ? null : (v ?? 0);
};

/** Totals as the table shows them while editing (the server prices again on save). */
export function liveBillTotals(
  values: BillFormValues,
  gstRateBp: number,
  intraState: boolean,
): { chargesPaise: number; sgstPaise: number; cgstPaise: number; igstPaise: number; advancePaise: number; amountPaise: number } {
  let charges = 0;
  let advance = 0;
  for (const l of Object.values(values.lines)) {
    if (!l.ticked) continue;
    charges += (amount(l.freight) ?? 0) + (amount(l.detention) ?? 0) + (amount(l.other) ?? 0);
    advance += amount(l.advance) ?? 0;
  }
  const gst = computeFreightGst(charges, values.gstMode, gstRateBp, intraState);
  return {
    chargesPaise: charges,
    ...gst,
    advancePaise: advance,
    amountPaise: charges + gst.sgstPaise + gst.cgstPaise + gst.igstPaise - advance,
  };
}

/** Ticked rows → the input `createFreightBill` / `updateFreightBill` take. Errors by field path. */
export function formToBillInput(
  values: BillFormValues,
  rows: BillLrRow[],
  gstRateBp: number,
): { ok: true; input: FreightBillInput } | { ok: false; errors: BillFormErrors } {
  const errors: BillFormErrors = {};
  if (!values.partyId) errors.partyId = "Pick the party to bill";
  if (!values.billDate) errors.billDate = "Enter the bill date";
  const lines: FreightBillInput["lines"] = [];
  for (const r of rows) {
    const l = values.lines[r.lrId];
    if (!l?.ticked) continue;
    const freight = parseRupees(l.freight);
    const detention = amount(l.detention);
    const other = amount(l.other);
    const advance = amount(l.advance);
    const key = (f: string) => `line.${r.lrId}.${f}`;
    if (freight === null || freight === undefined) {
      errors[key("freight")] = freight === null ? "Enter freight" : "Not an amount";
    }
    if (detention === null) errors[key("detention")] = "Not an amount";
    if (other === null) errors[key("other")] = "Not an amount";
    if (advance === null) errors[key("advance")] = "Not an amount";
    if (freight == null || detention === null || other === null || advance === null) continue;
    lines.push({
      lrId: r.lrId,
      freightPaise: freight,
      detentionPaise: detention,
      otherPaise: other,
      advancePaise: advance,
    });
  }
  if (!lines.length && !errors.partyId) errors.lines = "Tick at least one LR";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      billDate: values.billDate,
      partyId: values.partyId,
      gstMode: values.gstMode,
      gstRateBp: values.gstMode === "forward_charge" ? gstRateBp : 0,
      lines,
    },
  };
}

/** Maps a server validation path (`lines.2.freightPaise`) back to a form field. */
export function serverErrorKey(path: string, ticked: string[]): string {
  const m = /^lines\.(\d+)\.(\w+)$/.exec(path);
  if (!m) return path;
  const lrId = ticked[Number(m[1])];
  if (!lrId) return "lines";
  const field = m[2] === "lrId" ? "lr" : m[2].replace("Paise", "");
  return `line.${lrId}.${field}`;
}

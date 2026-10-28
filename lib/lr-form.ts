// Form state for New / Edit LR and how it maps to the data layer's LrInput.
// Pure functions (no React), shared by the form and its tests.
import { formatPaise, parseRupees } from "@/lib/format";
import { todayInIndia } from "@/lib/fy";
import { chargedAsLabel, paymentModeLabel } from "@/lib/labels";
import type {
  ChargedAs,
  GstPayer,
  Lr,
  LrCharges,
  LrPaymentMode,
  Party,
  Risk,
  TaxInvoice,
} from "@/lib/types";
import { lrBookingErrors, lrFields, type LrInput } from "@/lib/validators/lr";

export type ChargeKey = keyof LrCharges;

/** Charges shown on the form, in design order. Detention / other aren't on the form but kept. */
export const FORM_CHARGES: { key: ChargeKey; label: string }[] = [
  { key: "freight", label: "Freight" },
  { key: "packing", label: "Packing" },
  { key: "cnCharge", label: "C.N. charge" },
  { key: "loading", label: "Loading" },
  { key: "unloading", label: "Unloading" },
  { key: "gst", label: "GST" },
  { key: "advance", label: "Advance" },
];

const CHARGE_KEYS: ChargeKey[] = [
  "freight",
  "packing",
  "cnCharge",
  "loading",
  "unloading",
  "detention",
  "other",
  "gst",
  "advance",
];

export type LrInvoiceRow = {
  /** React key. */
  key: string;
  id?: string;
  taxInvoiceId: string | null;
  invoiceNo: string;
  /** yyyy-mm-dd */
  invoiceDate: string;
  /** Rupees as typed. */
  value: string;
  ewayBillNo: string;
  /** datetime-local value in IST, "2026-10-15T23:59". */
  ewayExpiresAt: string;
  /** Stored value, kept as-is when the user didn't change the expiry (keeps the seconds). */
  ewayExpiresAtIso: string | null;
};

export type LrItemRow = {
  key: string;
  id?: string;
  itemId: string | null;
  description: string;
  packages: string;
  /** Actual weight, kg. */
  weight: string;
  size: string;
  /** Not on the form; kept so editing doesn't wipe it. */
  chargedWeight: string | null;
};

export type LrFormValues = {
  lrDate: string;
  fromPlace: string;
  toPlace: string;
  risk: Risk;
  consignorId: string | null;
  consigneeId: string | null;
  /** "Same as consignee" — saved as billedToId = consigneeId. */
  billedToSame: boolean;
  billedToId: string | null;
  gstPaidBy: GstPayer | "";
  paymentMode: LrPaymentMode | "";
  chargedAs: ChargedAs | "";
  truckId: string | null;
  driverMobile: string;
  invoices: LrInvoiceRow[];
  items: LrItemRow[];
  /** Rupees as typed. */
  charges: Record<ChargeKey, string>;
  // Not on the form; carried through so editing doesn't wipe them.
  ratePaise: number | null;
  remarks: string;
};

/** Party details the form shows under a picker (and the checklist reads). */
export type PartyOption = Pick<Party, "id" | "name" | "place" | "gstin" | "phone" | "address">;

export type TruckOption = {
  id: string;
  number: string;
  driverMobile: string | null;
  lastLrNo: string | null;
};

export function rowKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyInvoiceRow(): LrInvoiceRow {
  return {
    key: rowKey(),
    taxInvoiceId: null,
    invoiceNo: "",
    invoiceDate: "",
    value: "",
    ewayBillNo: "",
    ewayExpiresAt: "",
    ewayExpiresAtIso: null,
  };
}

export function emptyItemRow(): LrItemRow {
  return {
    key: rowKey(),
    itemId: null,
    description: "",
    packages: "",
    weight: "",
    size: "",
    chargedWeight: null,
  };
}

const IST_OFFSET_MS = 330 * 60_000;

/** "2026-10-15T18:29:59.000Z" → "2026-10-15T23:59" (IST, for datetime-local). */
export function isoToIstInput(iso: string): string {
  return new Date(Date.parse(iso) + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** "2026-10-15T23:59" (IST) → "2026-10-15T18:29:00.000Z". Bad input → null. */
export function istInputToIso(local: string): string | null {
  const ms = Date.parse(`${local}:00+05:30`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const moneyText = (paise: number | null) => (paise === null ? "" : formatPaise(paise));

/** A valid rupee amount re-typed in Indian style ("184902.5" → "1,84,902.50"); else unchanged. */
export function tidyRupees(text: string): string {
  const paise = parseRupees(text);
  return typeof paise === "number" ? formatPaise(paise) : text;
}

export function emptyLrForm(today: string): LrFormValues {
  return {
    lrDate: today,
    fromPlace: "",
    toPlace: "",
    risk: "owner",
    consignorId: null,
    consigneeId: null,
    billedToSame: true,
    billedToId: null,
    gstPaidBy: "",
    paymentMode: "",
    chargedAs: "",
    truckId: null,
    driverMobile: "",
    invoices: [emptyInvoiceRow()],
    items: [emptyItemRow()],
    charges: Object.fromEntries(CHARGE_KEYS.map((k) => [k, ""])) as Record<ChargeKey, string>,
    ratePaise: null,
    remarks: "",
  };
}

/**
 * Form values for an existing LR. With `copy` (New LR from ?from=), the date becomes today and
 * goods invoices / e-way bills start empty; row ids are dropped so new rows are created.
 */
export function lrToForm(lr: Lr, opts: { copy?: boolean; today: string }): LrFormValues {
  const copy = !!opts.copy;
  const sameAsConsignee = lr.billedToId === null || lr.billedToId === lr.consigneeId;
  const invoices: LrInvoiceRow[] = copy
    ? [emptyInvoiceRow()]
    : lr.lrInvoices.map((i) => ({
        key: rowKey(),
        id: i.id,
        taxInvoiceId: i.taxInvoiceId,
        invoiceNo: i.invoiceNo,
        invoiceDate: i.invoiceDate ?? "",
        value: moneyText(i.valuePaise),
        ewayBillNo: i.ewayBillNo ?? "",
        ewayExpiresAt: i.ewayExpiresAt ? isoToIstInput(i.ewayExpiresAt) : "",
        ewayExpiresAtIso: i.ewayExpiresAt,
      }));
  const items: LrItemRow[] = lr.items.map((i) => ({
    key: rowKey(),
    id: copy ? undefined : i.id,
    itemId: i.itemId,
    description: i.description,
    packages: String(i.packages),
    weight: i.actualWeight ?? "",
    size: i.size ?? "",
    chargedWeight: i.chargedWeight,
  }));
  return {
    lrDate: copy ? opts.today : (lr.lrDate ?? ""),
    fromPlace: lr.fromPlace ?? "",
    toPlace: lr.toPlace ?? "",
    risk: lr.risk,
    consignorId: lr.consignorId,
    consigneeId: lr.consigneeId,
    billedToSame: sameAsConsignee,
    billedToId: sameAsConsignee ? null : lr.billedToId,
    gstPaidBy: lr.gstPaidBy ?? "",
    paymentMode: lr.paymentMode ?? "",
    chargedAs: lr.chargedAs ?? "",
    truckId: lr.truckId,
    driverMobile: lr.driverMobile ?? "",
    invoices: invoices.length ? invoices : [emptyInvoiceRow()],
    items: items.length ? items : [emptyItemRow()],
    charges: Object.fromEntries(CHARGE_KEYS.map((k) => [k, moneyText(lr.charges[k])])) as Record<
      ChargeKey,
      string
    >,
    ratePaise: lr.ratePaise,
    remarks: lr.remarks ?? "",
  };
}

/**
 * New LR from a goods (tax) invoice (?invoice=): seller → consignor, bill-to → consignee,
 * invoice lines → goods rows, invoice total → goods value, plus its truck and driver.
 */
export function invoiceToForm(inv: TaxInvoice, opts: { today: string }): LrFormValues {
  const base = emptyLrForm(opts.today);
  const items: LrItemRow[] = inv.lines.map((l) => {
    const qty = Number(l.qty);
    return {
      ...emptyItemRow(),
      itemId: l.itemId,
      description: l.description,
      // Whole quantities are package counts; anything else (e.g. kg) is left for the user.
      packages: Number.isInteger(qty) ? String(qty) : "",
    };
  });
  return {
    ...base,
    consignorId: inv.sellerPartyId,
    consigneeId: inv.billToId,
    truckId: inv.truckId,
    driverMobile: inv.driverMobile ?? "",
    invoices: [
      {
        ...emptyInvoiceRow(),
        taxInvoiceId: inv.id,
        invoiceNo: inv.invoiceNo,
        invoiceDate: todayInIndia(new Date(inv.invoiceAt)),
        value: moneyText(inv.totals.totalPaise),
        ewayBillNo: inv.ewayBillNo ?? "",
      },
    ],
    items: items.length ? items : base.items,
  };
}

/** GST is only charged on the LR when the transporter pays it. */
export function gstApplies(v: Pick<LrFormValues, "gstPaidBy">): boolean {
  return v.gstPaidBy === "transporter";
}

const blankInvoice = (r: LrInvoiceRow) =>
  !r.invoiceNo.trim() &&
  !r.invoiceDate &&
  !r.value.trim() &&
  !r.ewayBillNo.trim() &&
  !r.ewayExpiresAt;
const blankItem = (r: LrItemRow) =>
  !r.description.trim() && !r.packages.trim() && !r.weight.trim() && !r.size.trim();

const MONEY_ERROR = "Enter an amount like 1,250.50";

export type FormErrors = Record<string, string>;

export type LrFormResult = {
  input: LrInput;
  /** Keyed by form path, e.g. "driverMobile", "lrInvoices.1.ewayBillNo" (index = form row). */
  errors: FormErrors;
  /** Maps a data-layer path ("lrInvoices.0.x", index into the saved list) to a form path. */
  toFormPath: (path: string) => string;
};

/** Form → LrInput, validated with the same Zod schema the data layer uses. Blank rows are dropped. */
export function formToLrInput(v: LrFormValues): LrFormResult {
  const errors: FormErrors = {};
  const invoiceRows: number[] = [];
  const itemRows: number[] = [];

  const lrInvoices = v.invoices.flatMap((r, i) => {
    if (blankInvoice(r)) return [];
    invoiceRows.push(i);
    const valuePaise = parseRupees(r.value);
    if (valuePaise === undefined) errors[`lrInvoices.${i}.valuePaise`] = MONEY_ERROR;
    let ewayExpiresAt: string | null = null;
    if (r.ewayExpiresAt) {
      ewayExpiresAt =
        r.ewayExpiresAtIso && isoToIstInput(r.ewayExpiresAtIso) === r.ewayExpiresAt
          ? r.ewayExpiresAtIso
          : istInputToIso(r.ewayExpiresAt);
      if (!ewayExpiresAt) errors[`lrInvoices.${i}.ewayExpiresAt`] = "Not a valid date/time";
    }
    return [
      {
        id: r.id,
        invoiceNo: r.invoiceNo,
        invoiceDate: r.invoiceDate || null,
        valuePaise: valuePaise ?? null,
        ewayBillNo: r.ewayBillNo || null,
        ewayExpiresAt,
        taxInvoiceId: r.taxInvoiceId,
      },
    ];
  });

  const items = v.items.flatMap((r, i) => {
    if (blankItem(r)) return [];
    itemRows.push(i);
    const pk = r.packages.trim();
    let packages = 0;
    if (pk && !/^\d+$/.test(pk)) errors[`items.${i}.packages`] = "Enter a whole number";
    else packages = pk ? Number(pk) : 0;
    return [
      {
        id: r.id,
        itemId: r.itemId,
        description: r.description,
        packages,
        actualWeight: r.weight.trim() || null,
        chargedWeight: r.chargedWeight,
        size: r.size.trim() || null,
      },
    ];
  });

  const charges = Object.fromEntries(
    CHARGE_KEYS.map((k) => {
      if (k === "gst" && !gstApplies(v)) return [k, null];
      const paise = parseRupees(v.charges[k]);
      if (paise === undefined) errors[`charges.${k}`] = MONEY_ERROR;
      return [k, paise ?? null];
    }),
  ) as LrCharges;

  const input: LrInput = {
    lrDate: v.lrDate || null,
    fromPlace: v.fromPlace || null,
    toPlace: v.toPlace || null,
    risk: v.risk,
    consignorId: v.consignorId,
    consigneeId: v.consigneeId,
    billedToId: v.billedToSame ? v.consigneeId : v.billedToId,
    gstPaidBy: v.gstPaidBy || null,
    paymentMode: v.paymentMode || null,
    chargedAs: v.chargedAs || null,
    ratePaise: v.ratePaise,
    truckId: v.truckId,
    driverMobile: v.driverMobile || null,
    lrInvoices,
    items,
    charges,
    remarks: v.remarks || null,
  };

  const toFormPath = (path: string) => {
    const [head, idx, ...rest] = path.split(".");
    const rows = head === "lrInvoices" ? invoiceRows : head === "items" ? itemRows : null;
    if (!rows || idx === undefined || !/^\d+$/.test(idx)) return path;
    return [head, rows[Number(idx)] ?? idx, ...rest].join(".");
  };

  const parsed = lrFields.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = toFormPath(issue.path.join("."));
      // Our own messages (money, packages) win over Zod's for the same field.
      errors[path] ??= issue.message;
    }
  }
  return { input, errors, toFormPath };
}

/** Fields still needed before the LR can be booked, keyed by form path. */
export function bookingErrors(v: LrFormValues): FormErrors {
  const errors: FormErrors = {};
  for (const e of lrBookingErrors({
    lrDate: v.lrDate || null,
    fromPlace: v.fromPlace.trim() || null,
    toPlace: v.toPlace.trim() || null,
    consignorId: v.consignorId,
    consigneeId: v.consigneeId,
    paymentMode: v.paymentMode || null,
    items: v.items.map((r) => ({ packages: packagesOf(r) })),
  })) {
    errors[e.path] = e.message;
  }
  return errors;
}

/** Total of all charges (incl. GST) and what is left after the advance, in paise. */
export function lrChargeTotals(v: Pick<LrFormValues, "charges" | "gstPaidBy">): {
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
} {
  const amount = (k: ChargeKey) => {
    if (k === "gst" && !gstApplies(v)) return 0;
    return parseRupees(v.charges[k]) ?? 0;
  };
  const totalPaise = CHARGE_KEYS.filter((k) => k !== "advance").reduce(
    (sum, k) => sum + amount(k),
    0,
  );
  const advancePaise = amount("advance");
  return { totalPaise, advancePaise, balancePaise: totalPaise - advancePaise };
}

const packagesOf = (r: LrItemRow) => (/^\d+$/.test(r.packages.trim()) ? Number(r.packages) : 0);

export function totalPackages(v: Pick<LrFormValues, "items">): number {
  return v.items.reduce((sum, r) => sum + packagesOf(r), 0);
}

export type ChecklistLine = { tone: "ok" | "warn" | "todo"; text: string };

const gstPayerShort: Record<GstPayer, string> = {
  consignor: "GST by consignor",
  consignee: "GST by consignee",
  transporter: "GST by transporter",
};

/** "From Painal · FTL · TBB · GST by consignor" for the defaults banner. */
export function describeDefaults(d: {
  fromPlace: string | null;
  chargedAs: ChargedAs | null;
  paymentMode: LrPaymentMode | null;
  gstPaidBy: GstPayer | null;
}): string {
  return [
    d.fromPlace && `From ${d.fromPlace}`,
    d.chargedAs && chargedAsLabel[d.chargedAs],
    d.paymentMode && paymentModeLabel[d.paymentMode],
    d.gstPaidBy && gstPayerShort[d.gstPaidBy],
  ]
    .filter(Boolean)
    .join(" · ");
}

type DefaultFields = Pick<LrFormValues, "fromPlace" | "chargedAs" | "paymentMode" | "gstPaidBy">;

/** A consignor's remembered values, from their last booked LR (lrNo) or the party's settings. */
export type ConsignorDefaultValues = {
  lrNo: string | null;
  fromPlace: string | null;
  chargedAs: ChargedAs | null;
  paymentMode: LrPaymentMode | null;
  gstPaidBy: GstPayer | null;
};

/** What the "Defaults filled from …" bar shows, and what Undo puts back. */
export type DefaultsFill = {
  lrNo: string | null;
  text: string;
  consignorName: string;
  gstPaidBy: GstPayer | null;
  previous: DefaultFields;
};

/**
 * Fills From / charged as / payment mode / GST payer from a consignor's defaults.
 * `previous` is what Undo restores (pass the earlier fill's when re-filling).
 */
export function applyConsignorDefaults(
  v: LrFormValues,
  d: ConsignorDefaultValues,
  consignorName: string,
  previous: DefaultFields = {
    fromPlace: v.fromPlace,
    chargedAs: v.chargedAs,
    paymentMode: v.paymentMode,
    gstPaidBy: v.gstPaidBy,
  },
): { patch: DefaultFields; fill: DefaultsFill } {
  return {
    patch: {
      fromPlace: d.fromPlace ?? previous.fromPlace,
      chargedAs: d.chargedAs ?? previous.chargedAs,
      paymentMode: d.paymentMode ?? previous.paymentMode,
      gstPaidBy: d.gstPaidBy ?? previous.gstPaidBy,
    },
    fill: {
      lrNo: d.lrNo,
      text: describeDefaults(d),
      consignorName,
      gstPaidBy: d.gstPaidBy,
      previous,
    },
  };
}

/** Goods worth more than ₹50,000 need an e-way bill (GST rule 138). */
export const EWAY_THRESHOLD_PAISE = 50_000_00;

/** This goods invoice is over the e-way limit and has no e-way bill number. */
export function needsEwayBill(r: LrInvoiceRow): boolean {
  const value = parseRupees(r.value);
  return typeof value === "number" && value > EWAY_THRESHOLD_PAISE && !r.ewayBillNo.trim();
}

/** Sum of the goods invoices' values (rows with a blank or bad value count as 0). */
export function invoicesTotalPaise(rows: LrInvoiceRow[]): number {
  return rows.reduce((sum, r) => {
    const v = parseRupees(r.value);
    return sum + (typeof v === "number" ? v : 0);
  }, 0);
}

/** Other LRs already carrying an invoice row, by row key (filled as the user types). */
export type InvoiceDuplicates = Record<string, { id: string; lrNo: string }[]>;

/** The "Before you save" list on the right of the form. */
export function lrChecklist(
  v: LrFormValues,
  consignor: PartyOption | null,
  duplicates: InvoiceDuplicates = {},
): ChecklistLine[] {
  const lines: ChecklistLine[] = [];

  if (!v.consignorId || !consignor) lines.push({ tone: "todo", text: "Consignor not picked" });
  else if (consignor.gstin) lines.push({ tone: "ok", text: "Consignor matched by GST" });
  else lines.push({ tone: "warn", text: "Consignor has no GSTIN" });

  if (!v.consigneeId) lines.push({ tone: "todo", text: "Consignee not picked" });

  const pkgs = totalPackages(v);
  lines.push(
    pkgs > 0
      ? { tone: "ok", text: `${pkgs} package${pkgs === 1 ? "" : "s"} totalled` }
      : { tone: "todo", text: "No packages entered" },
  );

  const invoices = v.invoices.filter((r) => !blankInvoice(r));
  if (invoices.length === 0) {
    lines.push({ tone: "todo", text: "No goods invoice added" });
  } else {
    const noEway = invoices.filter(needsEwayBill);
    if (noEway.length === 1 && invoices.length === 1)
      lines.push({ tone: "warn", text: "E-way bill number missing" });
    else if (noEway.length)
      lines.push({
        tone: "warn",
        text: `E-way bill number missing on ${noEway.map((r) => r.invoiceNo || "an invoice").join(", ")} (over ₹50,000)`,
      });
    else if (invoices.some((r) => r.ewayBillNo.trim()))
      lines.push({ tone: "ok", text: "E-way bill entered" });

    if (invoices.some((r) => !r.value.trim()))
      lines.push({ tone: "warn", text: "Goods value missing" });

    for (const r of invoices) {
      const on = duplicates[r.key];
      if (on?.length)
        lines.push({
          tone: "warn",
          text: `Invoice ${r.invoiceNo.trim()} is already on LR ${on.map((x) => x.lrNo).join(", ")}`,
        });
    }
  }

  if (!v.items.some((r) => r.weight.trim() || r.size.trim()))
    lines.push({ tone: "todo", text: "Weight empty" });

  if (!v.truckId) lines.push({ tone: "todo", text: "Truck not picked" });

  const need: [keyof LrFormValues, string][] = [
    ["lrDate", "LR date"],
    ["fromPlace", "From"],
    ["toPlace", "To"],
    ["paymentMode", "Payment mode"],
  ];
  for (const [key, label] of need) {
    if (!v[key]) lines.push({ tone: "todo", text: `${label} needed to book` });
  }
  return lines;
}

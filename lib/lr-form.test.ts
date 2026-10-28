import { describe, expect, it } from "vitest";
import { mockTaxInvoices } from "@/lib/mock/invoices";
import { mockLrs } from "@/lib/mock/lrs";
import {
  applyConsignorDefaults,
  bookingErrors,
  describeDefaults,
  emptyLrForm,
  formToLrInput,
  invoiceToForm,
  isoToIstInput,
  istInputToIso,
  lrChargeTotals,
  lrChecklist,
  lrToForm,
  type LrFormValues,
} from "./lr-form";
import { todayInIndia } from "./fy";

const lr19019 = mockLrs.find((l) => l.lrNo === "19019")!;
const lr19020 = mockLrs.find((l) => l.lrNo === "19020")!;
const today = "2026-10-28";

const withCharges = (v: LrFormValues, charges: Partial<LrFormValues["charges"]>) => ({
  ...v,
  charges: { ...v.charges, ...charges },
});

describe("lrToForm / formToLrInput", () => {
  it("round-trips a saved LR", () => {
    const { input, errors } = formToLrInput(lrToForm(lr19019, { today }));
    expect(errors).toEqual({});
    expect(input).toMatchObject({
      lrDate: "2026-10-14",
      fromPlace: "Painal",
      billedToId: lr19019.billedToId,
      truckId: lr19019.truckId,
      driverMobile: "7870015869",
    });
    // Unchanged e-way expiry keeps its seconds.
    expect(input.lrInvoices).toEqual(lr19019.lrInvoices);
    expect(input.items).toEqual(lr19019.items);
  });

  it("copies everything except date, goods invoices and row ids", () => {
    const v = lrToForm(lr19019, { copy: true, today });
    expect(v.lrDate).toBe(today);
    expect(v.invoices).toHaveLength(1);
    expect(v.invoices[0].invoiceNo).toBe("");
    const { input } = formToLrInput(v);
    expect(input.lrInvoices).toEqual([]);
    expect(input.items?.[0].id).toBeUndefined();
    expect(input.consignorId).toBe(lr19019.consignorId);
    expect(input.paymentMode).toBe("tbb");
  });

  it("treats a missing billed-to as same as consignee", () => {
    const v = lrToForm(lr19020, { today });
    expect(v.billedToSame).toBe(true);
    expect(formToLrInput(v).input.billedToId).toBe(lr19020.consigneeId);
  });

  it("drops blank rows and maps errors back to form rows", () => {
    const v = emptyLrForm(today);
    v.invoices = [
      { ...v.invoices[0] },
      { ...v.invoices[0], key: "b", invoiceNo: "INV-2", ewayBillNo: "1234", value: "12.345" },
    ];
    v.driverMobile = "12345";
    const { input, errors, toFormPath } = formToLrInput(v);
    expect(input.lrInvoices).toHaveLength(1);
    expect(errors["lrInvoices.1.ewayBillNo"]).toMatch(/12 digits/);
    expect(errors["lrInvoices.1.valuePaise"]).toMatch(/amount/);
    expect(errors.driverMobile).toMatch(/10 digits/);
    expect(toFormPath("lrInvoices.0.invoiceNo")).toBe("lrInvoices.1.invoiceNo");
  });

  it("stores money as paise and ignores GST unless the transporter pays it", () => {
    const v = withCharges(
      { ...emptyLrForm(today), gstPaidBy: "consignor" },
      { freight: "1,000", gst: "50" },
    );
    expect(formToLrInput(v).input.charges).toMatchObject({ freight: 100000, gst: null });
    const t = { ...v, gstPaidBy: "transporter" as const };
    expect(formToLrInput(t).input.charges).toMatchObject({ gst: 5000 });
  });
});

describe("booking and totals", () => {
  it("lists what is needed to book", () => {
    expect(Object.keys(bookingErrors(emptyLrForm(today))).sort()).toEqual(
      ["consigneeId", "consignorId", "fromPlace", "items", "paymentMode", "toPlace"].sort(),
    );
    expect(bookingErrors(lrToForm(lr19019, { today }))).toEqual({});
  });

  it("computes total and balance", () => {
    const v = withCharges(
      { ...emptyLrForm(today), gstPaidBy: "transporter" },
      { freight: "10,000", loading: "500", gst: "1,260", advance: "2,000", packing: "x" },
    );
    expect(lrChargeTotals(v)).toEqual({
      totalPaise: 1176000,
      advancePaise: 200000,
      balancePaise: 976000,
    });
  });
});

describe("checklist and labels", () => {
  it("matches the design's lines for the sample draft", () => {
    const consignor = {
      id: lr19020.consignorId!,
      name: "Ashirvad Pipes Pvt Ltd",
      place: "Painal",
      gstin: "10AABCA7061K2ZZ",
      phone: null,
      address: null,
    };
    const lines = lrChecklist(lrToForm(lr19020, { today }), consignor);
    expect(lines).toEqual(
      expect.arrayContaining([
        { tone: "ok", text: "Consignor matched by GST" },
        { tone: "ok", text: "25 packages totalled" },
        { tone: "warn", text: "E-way bill number missing" },
        { tone: "todo", text: "Weight empty" },
        { tone: "todo", text: "LR date needed to book" },
      ]),
    );
  });

  it("describes filled defaults", () => {
    expect(
      describeDefaults({
        fromPlace: "Painal",
        chargedAs: "ftl",
        paymentMode: "tbb",
        gstPaidBy: "consignor",
      }),
    ).toBe("From Painal · FTL · TBB · GST by consignor");
  });
});

describe("dates", () => {
  it("converts e-way expiry between UTC and IST input", () => {
    expect(isoToIstInput("2026-10-15T18:29:59.000Z")).toBe("2026-10-15T23:59");
    expect(istInputToIso("2026-10-15T23:59")).toBe("2026-10-15T18:29:00.000Z");
    expect(istInputToIso("nope")).toBeNull();
  });

  it("dates today in India", () => {
    expect(todayInIndia(new Date("2026-10-27T19:00:00.000Z"))).toBe("2026-10-28");
  });
});

describe("New LR from a tax invoice", () => {
  it("fills parties, goods, value and truck, linked to the invoice", () => {
    const inv = mockTaxInvoices[0];
    const v = invoiceToForm(inv, { today });
    expect(v).toMatchObject({
      lrDate: today,
      consignorId: inv.sellerPartyId,
      consigneeId: inv.billToId,
      billedToSame: true,
      truckId: inv.truckId,
      driverMobile: "8873764100",
    });
    expect(v.items.map((r) => [r.description, r.packages])).toEqual([
      ["500 LTR 4-layer white water tank", "10"],
      ["1000 LTR 3-layer white water tank", "5"],
      ["1000 LTR 4-layer white water tank", "10"],
    ]);
    const { input, errors } = formToLrInput(v);
    expect(errors).toEqual({});
    expect(input.lrInvoices).toEqual([
      expect.objectContaining({
        invoiceNo: "SQ2604002116",
        invoiceDate: "2026-10-10",
        valuePaise: 18490258,
        ewayBillNo: null,
        taxInvoiceId: inv.id,
      }),
    ]);
  });
});

describe("consignor defaults", () => {
  const d = {
    lrNo: "19019",
    fromPlace: "Painal",
    chargedAs: "ftl" as const,
    paymentMode: "tbb" as const,
    gstPaidBy: "consignor" as const,
  };

  it("fills the four fields and remembers what Undo restores", () => {
    const v = { ...emptyLrForm(today), fromPlace: "Bihta", paymentMode: "paid" as const };
    const { patch, fill } = applyConsignorDefaults(v, d, "Ashirvad Pipes Pvt Ltd");
    expect(patch).toEqual({
      fromPlace: "Painal",
      chargedAs: "ftl",
      paymentMode: "tbb",
      gstPaidBy: "consignor",
    });
    expect(fill.previous).toEqual({
      fromPlace: "Bihta",
      chargedAs: "",
      paymentMode: "paid",
      gstPaidBy: "",
    });
    expect(fill.text).toBe("From Painal · FTL · TBB · GST by consignor");
  });

  it("keeps the first Undo point when another consignor is picked", () => {
    const v = emptyLrForm(today);
    const first = applyConsignorDefaults(v, d, "A");
    const second = applyConsignorDefaults(
      { ...v, ...first.patch },
      { ...d, fromPlace: null },
      "B",
      first.fill.previous,
    );
    expect(second.patch.fromPlace).toBe("");
    expect(second.fill.previous.fromPlace).toBe("");
  });
});

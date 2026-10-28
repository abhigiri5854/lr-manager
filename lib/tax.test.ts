import { describe, expect, it } from "vitest";
import { computeFreightGst, computeInvoiceTax } from "./tax";

// Invoice SQ2604002116 from the design.
const lines = [
  { qty: "10", ratePaise: 403004, discountPaise: 0, gstRateBp: 1800 },
  { qty: "5", ratePaise: 715920, discountPaise: 0, gstRateBp: 1800 },
  { qty: "10", ratePaise: 806007, discountPaise: 0, gstRateBp: 1800 },
];

describe("computeInvoiceTax", () => {
  it("reproduces invoice SQ2604002116 to the paisa, line by line and in total", () => {
    const r = computeInvoiceTax(lines, true);
    expect(r.lines.map((l) => [l.taxablePaise, l.sgstPaise, l.cgstPaise])).toEqual([
      [4030040, 362704, 362704],
      [3579600, 322164, 322164],
      [8060070, 725406, 725406],
    ]);
    expect(r.totals).toEqual({
      taxablePaise: 15669710,
      sgstPaise: 1410274,
      cgstPaise: 1410274,
      igstPaise: 0,
      roundOffPaise: 0,
      totalPaise: 18490258,
    });
  });

  it("uses IGST across states", () => {
    const r = computeInvoiceTax(lines, false);
    expect(r.totals.sgstPaise).toBe(0);
    expect(r.lines.map((l) => l.igstPaise)).toEqual([725407, 644328, 1450813]);
    expect(r.totals.igstPaise).toBe(2820548);
    expect(r.totals.totalPaise).toBe(18490258);
  });
});

describe("computeInvoiceTax — rules", () => {
  it("intra-state splits each line's tax into equal SGST and CGST, rounded per line", () => {
    // 3 × ₹33.33 at 5% = ₹99.99 taxable, tax ₹4.9995 → 2.49975 each → 250 paise each.
    const r = computeInvoiceTax(
      [{ qty: "3", ratePaise: 3333, discountPaise: 0, gstRateBp: 500 }],
      true,
    );
    expect(r.lines[0]).toEqual({
      taxablePaise: 9999,
      sgstPaise: 250,
      cgstPaise: 250,
      igstPaise: 0,
    });
    expect(r.totals.totalPaise).toBe(9999 + 500);
  });

  it("inter-state charges IGST only, rounded per line and summed", () => {
    const r = computeInvoiceTax(
      [
        { qty: "1", ratePaise: 1003, discountPaise: 0, gstRateBp: 1800 }, // 180.54 → 181
        { qty: "1", ratePaise: 1003, discountPaise: 0, gstRateBp: 1800 },
      ],
      false,
    );
    expect(r.lines.map((l) => l.igstPaise)).toEqual([181, 181]);
    expect(r.totals).toMatchObject({ sgstPaise: 0, cgstPaise: 0, igstPaise: 362 });
    expect(r.totals.totalPaise).toBe(2006 + 362);
  });

  it("takes the discount off before tax", () => {
    const r = computeInvoiceTax(
      [{ qty: "2", ratePaise: 100000, discountPaise: 20000, gstRateBp: 1200 }],
      false,
    );
    expect(r.lines[0].taxablePaise).toBe(180000);
    expect(r.lines[0].igstPaise).toBe(21600);
    expect(r.totals.totalPaise).toBe(201600);
  });

  it("handles fractional quantities and the 0.25% and 40% rates", () => {
    const r = computeInvoiceTax(
      [
        { qty: "1.5", ratePaise: 10001, discountPaise: 0, gstRateBp: 25 },
        { qty: "1", ratePaise: 10000, discountPaise: 0, gstRateBp: 4000 },
      ],
      false,
    );
    expect(r.lines[0].taxablePaise).toBe(15002); // 150.015 → 150.02
    expect(r.lines[0].igstPaise).toBe(38); // 37.505 → 38
    expect(r.lines[1].igstPaise).toBe(4000);
  });

  it("rounds the total to the nearest rupee as its own line when asked", () => {
    const up = computeInvoiceTax(lines, true, { roundOff: true });
    expect(up.totals.roundOffPaise).toBe(42);
    expect(up.totals.totalPaise).toBe(18490300);
    const down = computeInvoiceTax(
      [{ qty: "1", ratePaise: 10040, discountPaise: 0, gstRateBp: 0 }],
      true,
      { roundOff: true },
    );
    expect(down.totals.roundOffPaise).toBe(-40);
    expect(down.totals.totalPaise).toBe(10000);
    expect(computeInvoiceTax(lines, true, { roundOff: false }).totals.roundOffPaise).toBe(0);
  });
});

describe("computeFreightGst", () => {
  it("is zero under reverse charge", () => {
    expect(computeFreightGst(1000000, "reverse_charge", 1200, true)).toEqual({
      sgstPaise: 0,
      cgstPaise: 0,
      igstPaise: 0,
    });
  });
  it("splits forward charge by state", () => {
    expect(computeFreightGst(1000000, "forward_charge", 1200, true)).toEqual({
      sgstPaise: 60000,
      cgstPaise: 60000,
      igstPaise: 0,
    });
    expect(computeFreightGst(1000000, "forward_charge", 1200, false)).toEqual({
      sgstPaise: 0,
      cgstPaise: 0,
      igstPaise: 120000,
    });
  });
});

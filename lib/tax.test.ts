import { describe, expect, it } from "vitest";
import { computeFreightGst, computeInvoiceTax } from "./tax";

// Invoice SQ2604002116 from the design.
const lines = [
  { qty: "10", ratePaise: 403004, discountPaise: 0, gstRateBp: 1800 },
  { qty: "5", ratePaise: 715920, discountPaise: 0, gstRateBp: 1800 },
  { qty: "10", ratePaise: 806007, discountPaise: 0, gstRateBp: 1800 },
];

describe("computeInvoiceTax", () => {
  it("reproduces the design invoice line by line and in total", () => {
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
    expect(r.totals.igstPaise).toBe(2820548);
    expect(r.totals.totalPaise).toBe(18490258);
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

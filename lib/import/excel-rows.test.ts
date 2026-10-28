import { describe, expect, it } from "vitest";
import { importableRows, parseSheetDate, reviewExcelRows, type Lookups } from "./excel-rows";
import { mockReader } from "./mock-reader";
import type { ExcelReadResult } from "./types";

const none: Lookups = {
  lrPrefix: "",
  lrByNo: () => null,
  partyByGstin: () => null,
  partyByName: () => null,
  truckByNumber: () => null,
  taxInvoice: () => null,
};

async function sheet(): Promise<ExcelReadResult> {
  return mockReader.readExcel({ name: "x.xlsx", type: "", bytes: new Uint8Array([1]) });
}
const suggested = (r: ExcelReadResult) =>
  Object.fromEntries(r.columns.map((c) => [c.header, c.suggestedField]));

describe("parseSheetDate", () => {
  it("reads common formats and rejects impossible dates", () => {
    expect(parseSheetDate("15-10-2026")).toBe("2026-10-15");
    expect(parseSheetDate("5/1/26")).toBe("2026-01-05");
    expect(parseSheetDate("2026-10-15")).toBe("2026-10-15");
    expect(parseSheetDate("")).toBeNull();
    expect(parseSheetDate("31-02-2026")).toBeUndefined();
    expect(parseSheetDate("yesterday")).toBeUndefined();
  });
});

describe("reviewExcelRows (sample booking sheet)", () => {
  it("classifies the 10 rows: 5 valid, 2 warnings (existing LR, unusual vehicle), 3 errors", async () => {
    const r = await sheet();
    const lookups: Lookups = {
      ...none,
      lrByNo: (n) =>
        n === "19019" ? { id: "lr-19019", status: "in the register", updatable: true } : null,
      partyByName: (n) => (n === "Modern Sanitation" ? { id: "p2", name: n } : null),
    };
    const { rows, counts } = reviewExcelRows(r, suggested(r), {}, lookups);
    const by = (no: number) => rows.find((x) => x.rowNo === no)!;
    // Row 4 = LR 19021 … row 13 = LR 19027
    expect(by(4).status).toBe("valid");
    expect(by(8)).toMatchObject({
      status: "warning",
      existingLrId: "lr-19019",
      defaultAction: "skip",
    });
    expect(by(8).allowed).toEqual(["skip", "update"]);
    expect(by(9)).toMatchObject({ status: "warning" });
    expect(by(9).reasons[0]).toMatch(/Vehicle no\. "BR1GN" format unusual/);
    expect(by(10)).toMatchObject({ status: "error" });
    expect(by(10).reasons[0]).toBe("Consignor GSTIN has 14 characters (needs 15)");
    expect(by(11)).toMatchObject({ status: "error", allowed: ["skip"], action: "skip" });
    expect(by(11).reasons).toContain("LR number is missing");
    expect(by(12).reasons).toContain("LR 19022 appears again in this file (row 5)");
    expect(counts).toEqual({ valid: 5, warning: 2, error: 3 });
  });

  it("matches saved records and says what will be created", async () => {
    const r = await sheet();
    const lookups: Lookups = {
      ...none,
      partyByGstin: (g) =>
        g === "10AABCA7061K2ZZ" ? { id: "p1", name: "Ashirvad Pipes Pvt Ltd" } : null,
      truckByNumber: (n) => (n === "BR01GN8331" ? { id: "t1" } : null),
      taxInvoice: (no, gstin) =>
        no === "SQ2604002116" && gstin === "10AABCA7061K2ZZ" ? { id: "i1" } : null,
    };
    const { rows } = reviewExcelRows(r, suggested(r), {}, lookups);
    const first = rows[0];
    // Matching by GSTIN and a known truck are the normal case: nothing to say.
    expect(first.checks.filter((c) => /Consignor matched|Truck .* found/.test(c))).toEqual([]);
    expect(rows[1].checks).toContain(
      "Tax invoice SQ2604002116 found — the LR will be linked to it",
    );
    // spaced vehicle number is normalised
    expect(rows[2].parsed.vehicleNo).toBe("BR01GN8331");
    // row for LR 19024: new party with a valid GSTIN, new truck
    expect(rows[3].checks).toContain("New party Shree Ganesh Traders will be added");
    expect(rows[3].checks).toContain("New truck BR01GA4455 will be added");
  });

  it("follows the mapping: Wt as actual weight, Remarks 2 as remarks", async () => {
    const r = await sheet();
    const mapping = { ...suggested(r), Wt: "actual_weight", "Remarks 2": "remarks" };
    const { rows } = reviewExcelRows(r, mapping, {}, none);
    expect(rows[0].parsed).toMatchObject({
      actualWeight: "560.000",
      billingWeight: null,
      remarks: "Urgent",
    });
    const sure = reviewExcelRows(r, suggested(r), {}, none).rows[0].parsed;
    expect(sure).toMatchObject({ billingWeight: "560.000", actualWeight: null, remarks: null });
    expect(sure.ratePaise).toBe(1250);
    expect(sure.freightPaise).toBe(700000);
  });

  it("uses the user's action when it is allowed, otherwise the default", async () => {
    const r = await sheet();
    const lookups: Lookups = {
      ...none,
      lrByNo: (n) => (n === "19019" ? { id: "x", status: "ok", updatable: true } : null),
    };
    const { rows } = reviewExcelRows(
      r,
      suggested(r),
      { "4": "skip", "8": "update", "10": "import" },
      lookups,
    );
    expect(rows[0].action).toBe("skip");
    expect(rows[4].action).toBe("update");
    expect(rows[6].action).toBe("skip"); // error rows can only be skipped
    expect(importableRows(rows).map((x) => x.rowNo)).toEqual(
      [5, 6, 7, 8, 9, 13].filter((n) => n !== 10),
    );
  });

  it("won't offer Update for an LR that is cancelled or billed", async () => {
    const r = await sheet();
    const lookups: Lookups = {
      ...none,
      lrByNo: (n) => (n === "19019" ? { id: "x", status: "Billed", updatable: false } : null),
    };
    const row = reviewExcelRows(r, suggested(r), {}, lookups).rows[4];
    expect(row.allowed).toEqual(["skip"]);
    expect(row.reasons[0]).toBe("LR 19019 is already in the system (Billed) — it can't be updated");
  });

  it("strips the company's LR prefix from sheet numbers", async () => {
    const r = await sheet();
    r.rows[0].cells["LR No"] = "RSL/19021";
    const { rows } = reviewExcelRows(r, suggested(r), {}, { ...none, lrPrefix: "RSL/" });
    expect(rows[0].parsed.lrNo).toBe("19021");
  });
});

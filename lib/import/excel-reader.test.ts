import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { guessColumns } from "./column-match";
import { applySuggestions, buildQuestion } from "./column-suggest";
import { readExcel } from "./excel-reader";
import { parseSheetDate, reviewExcelRows, type Lookups } from "./excel-rows";

const none: Lookups = {
  lrPrefix: "",
  lrByNo: () => null,
  partyByGstin: () => null,
  partyByName: () => null,
  truckByNumber: () => null,
  taxInvoice: () => null,
};

const bytes = (wb: XLSX.WorkBook, bookType: XLSX.BookType = "xlsx") =>
  new Uint8Array(XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer);
const file = (b: Uint8Array, name = "x.xlsx") => ({ name, type: "", bytes: b });
const text = (s: string) => new TextEncoder().encode(s);

function book(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return wb;
}
const column = (r: Awaited<ReturnType<typeof readExcel>>, header: string) =>
  r.columns.find((c) => c.header === header);

describe("column matching", () => {
  it("places usual headers by name and keeps GSTIN apart from the name", () => {
    const g = guessColumns(["LR No.", "Consignor", "Consignor GSTIN", "Truck Number", "Pkgs", "Wt"]);
    expect(g.map((x) => x.field)).toEqual([
      "lr_no",
      "consignor_name",
      "consignor_gstin",
      "vehicle_no",
      "packages",
      "billing_weight",
    ]);
    expect(g.slice(0, 5).every((x) => x.confidence === "sure")).toBe(true);
    expect(g[5].confidence).toBe("confirm"); // "Wt" could be either weight
  });

  it("tolerates a typo and leaves unknown headers unmapped", () => {
    const g = guessColumns(["Consignne", "Dispatch Note"]);
    expect(g[0]).toMatchObject({ field: "consignee_name", via: "name" });
    expect(g[1]).toMatchObject({ field: "skip", via: "none" });
  });

  it("uses each field once", () => {
    const g = guessColumns(["Freight", "Freight Amount"]);
    expect(g.filter((x) => x.field === "freight")).toHaveLength(1);
  });

  it("applies saved mappings before names, matching headers loosely", () => {
    const g = guessColumns(
      ["Truck", "Dispatch Note"],
      [{ "dispatch  note": "remarks", Truck: "goods" }],
    );
    expect(g[0]).toMatchObject({ field: "goods", via: "saved", confidence: "sure" });
    expect(g[1]).toMatchObject({ field: "remarks", via: "saved" });
  });
});

describe("readExcel", () => {
  it("finds the header under a title, reads formula results and dates, normalises cells", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["RSL TRANSPORT - Booking report"],
      [],
      ["LR No", "LR Date", "Consignor", "Vehicle No", "Pkgs", "Freight"],
      [19021, 46310, "Ashirvad Pipes", "br 01 gn 8331", 28, "₹ 1,84,902.58"],
      [19022, 46311, "Ashirvad Pipes", "BR06GB7374", 15, "7,000/-"],
      ["Total", "", "", "", 43, ""],
    ]);
    // a date-formatted serial, and a formula whose result is cached
    ws["B4"].z = "dd-mm-yyyy";
    ws["E5"] = { t: "n", v: 15, f: "5*3" };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bookings");

    const r = await readExcel(file(bytes(wb)));
    expect(r.sheetName).toBe("Bookings");
    expect(r.headerRow).toBe(3);
    expect(r.rows.map((x) => x.rowNo)).toEqual([4, 5]); // the Total row is left out
    expect(r.rows[0].cells).toMatchObject({
      "LR No": "19021",
      "LR Date": "15-10-2026", // date-formatted cell
      "Vehicle No": "BR01GN8331",
      Freight: "184902.58",
    });
    expect(r.rows[1].cells).toMatchObject({
      "LR Date": "16-10-2026", // plain serial in a date column
      Pkgs: "15", // formula result
      Freight: "7000",
    });
    expect(column(r, "LR Date")).toMatchObject({ suggestedField: "lr_date", confidence: "sure" });
  });

  it("reads every sheet that shares the columns and ignores the rest", async () => {
    const head = ["LR No", "Consignor", "Freight"];
    const r = await readExcel(
      file(
        bytes(
          book({
            Oct: [head, [1, "A", 10], [2, "B", 20]],
            Summary: [
              ["Month", "Count"],
              ["Oct", 2],
            ],
            Nov: [head, [3, "C", 30]],
          }),
        ),
      ),
    );
    expect(r.sheetName).toBe("Oct, Nov");
    expect(r.rows.map((x) => x.cells["LR No"])).toEqual(["1", "2", "3"]);
    expect(new Set(r.rows.map((x) => x.rowNo)).size).toBe(3); // unique across sheets
    expect(r.rows[2]).toMatchObject({ sheet: "Nov", sheetRow: 2 });
  });

  it("reads CSV, keeping text as typed, with a UTF-8 BOM", async () => {
    const csv =
      '﻿LR No,Date,Consignor GSTIN,Freight\n00123,15/10/2026,10aabca7061k2zz,"1,84,902.58"\n';
    const r = await readExcel(file(text(csv), "x.csv"));
    expect(r.columns.map((c) => c.suggestedField)).toEqual([
      "lr_no",
      "lr_date",
      "consignor_gstin",
      "freight",
    ]);
    expect(r.rows[0].cells).toMatchObject({
      "LR No": "00123",
      Date: "15-10-2026",
      "Consignor GSTIN": "10AABCA7061K2ZZ",
      Freight: "184902.58",
    });
  });

  it("reads an old .xls too", async () => {
    const wb = book({
      S: [
        ["LR No", "To"],
        [5, "Patna"],
      ],
    });
    const r = await readExcel(file(bytes(wb, "biff8"), "x.xls"));
    expect(r.rows[0].cells).toEqual({ "LR No": "5", To: "Patna" });
  });

  it("names blank and repeated headers", async () => {
    const wb = book({ S: [["LR No", "", "Remarks", "Remarks"], [1, "x", "a", "b"]] });
    const r = await readExcel(file(bytes(wb)));
    expect(r.columns.map((c) => c.header)).toEqual(["LR No", "Column B", "Remarks", "Remarks (2)"]);
  });

  it("asks the Gemini hook once, only about unplaced columns, and marks the answer 'confirm'", async () => {
    let asked = 0;
    const wb = book({
      S: [
        ["LR No", "Mystery", "Other"],
        [1, "BR01GN8331", ""],
        [2, "BR06GB7374", ""],
      ],
    });
    const r = await readExcel(file(bytes(wb)), {
      suggestColumns: async (q) => {
        asked++;
        expect(q.unmapped).toEqual(["Mystery"]); // "Other" has no data
        expect(q.sampleRows).toHaveLength(2);
        return [
          { header: "Mystery", field: "vehicle_no" },
          { header: "LR No", field: "goods" }, // not asked about: ignored
        ];
      },
    });
    expect(asked).toBe(1);
    expect(column(r, "Mystery")).toMatchObject({ suggestedField: "vehicle_no", confidence: "confirm" });
    expect(column(r, "LR No")).toMatchObject({ suggestedField: "lr_no", confidence: "sure" });
  });

  it("makes no Gemini call when every column is placed", async () => {
    let asked = 0;
    const wb = book({ S: [["LR No", "To"], [1, "x"]] });
    await readExcel(file(bytes(wb)), {
      suggestColumns: async () => {
        asked++;
        return null;
      },
    });
    expect(asked).toBe(0);
  });

  it("fails clearly on a file with no table", async () => {
    await expect(readExcel(file(bytes(book({ S: [["only a title"]] }))))).rejects.toThrow(/No table/);
    await expect(readExcel(file(text("")))).rejects.toThrow();
  });

  it("feeds the row review", async () => {
    const wb = book({ S: [["LR No", "LR Date", "Vehicle No"], [7, 46310, "BR 01 GN 8331"]] });
    const r = await readExcel(file(bytes(wb)));
    const mapping = Object.fromEntries(r.columns.map((c) => [c.header, c.suggestedField]));
    const { rows } = reviewExcelRows(r, mapping, {}, none);
    expect(rows[0].parsed).toMatchObject({ lrNo: "7", lrDate: "2026-10-15", vehicleNo: "BR01GN8331" });
  });
});

describe("Gemini column answers", () => {
  it("accepts only asked headers and free fields, once each", () => {
    const guesses = guessColumns(["LR No", "A", "B"]);
    const q = buildQuestion(
      guesses,
      [{ cells: { "LR No": "1", A: "x", B: "y" } }],
      ["goods", "remarks"],
    )!;
    const out = applySuggestions(guesses, q, [
      { header: "A", field: "goods" },
      { header: "B", field: "goods" }, // taken
      { header: "LR No", field: "remarks" }, // not asked
      { header: "B", field: "nonsense" },
    ]);
    expect(out.map((g) => [g.field, g.confidence])).toEqual([
      ["lr_no", "sure"],
      ["goods", "confirm"],
      ["skip", "sure"],
    ]);
  });
});

describe("date serials", () => {
  it("parseSheetDate reads Excel serial numbers", () => {
    expect(parseSheetDate("46310")).toBe("2026-10-15");
    expect(parseSheetDate("46310.75")).toBe("2026-10-15");
  });
});

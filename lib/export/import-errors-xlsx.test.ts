import { describe, expect, it } from "vitest";
import { read, utils } from "xlsx";
import { importErrorReportWorkbook } from "./import-errors-xlsx";

describe("Smart import error report", () => {
  it("lists each failed row with its reason and its original cells", () => {
    const bytes = importErrorReportWorkbook({
      fileName: "RSL.xlsx",
      headers: ["LR No", "Consignor GSTIN"],
      rows: [
        {
          rowNo: 10,
          record: "19026 · Patel → Vaishno",
          reason: "Consignor GSTIN has 14 characters (needs 15)",
          cells: ["19026", "10AABCP3456L1Z"],
        },
        {
          rowNo: 11,
          record: "— · A → B",
          reason: "LR number is missing",
          cells: ["", "10AABCA7061K2ZZ"],
        },
      ],
    });
    const rows = utils.sheet_to_json<Record<string, unknown>>(read(bytes).Sheets["Errors"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      "Excel row": 10,
      "What's wrong": "Consignor GSTIN has 14 characters (needs 15)",
      "LR No": "19026",
      "Consignor GSTIN": "10AABCP3456L1Z",
    });
    expect(rows[1]["What's wrong"]).toBe("LR number is missing");
  });
});

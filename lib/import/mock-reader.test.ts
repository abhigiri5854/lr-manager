import { describe, expect, it } from "vitest";
import { mockReader, sampleFor } from "./mock-reader";

const file = (name: string) => ({ name, type: "", bytes: new Uint8Array([1]) });

describe("mock reader", () => {
  it("returns the sample booking sheet for any workbook, in the reader shape", async () => {
    const r = await mockReader.readExcel(file("anything.xlsx"));
    expect(r).toMatchObject({ kind: "excel", sheetName: "Sheet1", headerRow: 3 });
    expect(r.columns).toHaveLength(15);
    expect(r.rows).toHaveLength(10);
    expect(r.rows[0].rowNo).toBe(4);
    // every row has a cell for every column
    for (const row of r.rows)
      expect(Object.keys(row.cells)).toEqual(r.columns.map((c) => c.header));
    // two columns the reader isn't sure about, like the design
    expect(r.columns.filter((c) => c.confidence === "confirm").map((c) => c.header)).toEqual([
      "Wt",
      "Remarks 2",
    ]);
  });

  it("picks a sample document by file name", () => {
    expect(sampleFor("LR_19019.png")).toBe("lr");
    expect(sampleFor("lr 19020.jpg")).toBe("lr");
    expect(sampleFor("invoice_SQ2604002117.png")).toBe("invoice_new");
    expect(sampleFor("new-invoice.pdf")).toBe("invoice_new");
    expect(sampleFor("invoice_SQ2604002116.png")).toBe("invoice");
    expect(sampleFor("scan001.pdf")).toBe("invoice");
  });

  it("reads the sample invoice SQ2604002116 with its totals' inputs", async () => {
    const r = await mockReader.readDocument(file("invoice_SQ2604002116.png"));
    expect(r).toMatchObject({ documentType: "tax_invoice", pages: 1 });
    expect(r.invoice?.invoiceNo).toBe("SQ2604002116");
    expect(r.invoice?.lines).toHaveLength(3);
    expect(r.invoice?.vehicleNo).toBe("BR06GB7374");
    expect(r.lowConfidence.length).toBeGreaterThan(0);
  });

  it("reads LR_19019 as a consignment note", async () => {
    const r = await mockReader.readDocument(file("LR_19019.png"));
    expect(r.documentType).toBe("lr");
    expect(r.lr?.lrNo).toBe("19019");
    expect(r.invoice).toBeNull();
  });
});

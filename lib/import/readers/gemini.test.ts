import { describe, expect, it } from "vitest";
import { groundedInText } from "./gemini";

const draft = { invoiceNo: "ACM/26/0004", sellerName: "Sample Example Traders", lines: [] };

describe("groundedInText", () => {
  it("does not reject names that contain words like sample or example", () => {
    expect(groundedInText(draft, "Invoice ACM/26/0004 Sample Example Traders")).toBe(draft);
  });

  it("rejects an invoice number that is not in the text layer", () => {
    expect(groundedInText(draft, "Invoice XYZ-1 Sample Example Traders")).toBeNull();
  });

  it("accepts anything when there is no text layer", () => {
    expect(groundedInText(draft, null)).toBe(draft);
  });

  it("leaves GSTIN and vehicle numbers alone", () => {
    const d = { ...draft, sellerGstin: "10AAXFA2859G1ZD", vehicleNo: "BR01GJ3969" };
    expect(groundedInText(d, "Invoice ACM/26/0004")).toBe(d);
  });
});

import { describe, expect, it } from "vitest";
import { parseEInvoiceQr, qrDateToIso } from "./qr-payload";
import { parseInvoiceText, textDateToIso } from "./text-parser";

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (data: unknown) =>
  `${b64url({ alg: "RS256" })}.${b64url({ data: JSON.stringify(data), iss: "NIC" })}.sig`;

describe("e-invoice QR", () => {
  it("reads the signed payload", () => {
    const q = parseEInvoiceQr(
      jwt({
        SellerGstin: "10AABCA7061K2ZZ",
        BuyerGstin: "10APIPP4518H1Z3",
        DocNo: "SQ2604002116",
        DocDt: "10/10/2026",
        TotInvVal: 184902.58,
        ItemCnt: 3,
        MainHsnCode: "39251000",
        Irn: "a".repeat(64),
      }),
    );
    expect(q).toMatchObject({
      docNo: "SQ2604002116",
      docDate: "2026-10-10",
      totalPaise: 18490258,
      itemCount: 3,
      mainHsn: "39251000",
    });
  });

  it("rejects other QR text", () => {
    expect(parseEInvoiceQr("upi://pay?pa=x@y")).toBeNull();
    expect(parseEInvoiceQr(jwt({ SellerGstin: "10AABCA7061K2ZZ" }))).toBeNull();
  });

  it("converts dd/mm/yyyy", () => {
    expect(qrDateToIso("05/04/2026")).toBe("2026-04-05");
    expect(qrDateToIso("32/01/2026")).toBeNull();
  });
});

describe("invoice text rules", () => {
  it("reads dates in common layouts", () => {
    expect(textDateToIso("10-Oct-2026")).toBe("2026-10-10");
    expect(textDateToIso("10.10.2026")).toBe("2026-10-10");
  });

  it("finds header fields, an item row and the totals", () => {
    const d = parseInvoiceText(
      [
        "TAX INVOICE",
        "Invoice No: SQ2604002116 Invoice Date: 10-10-2026",
        "GSTIN 10AABCA7061K2ZZ",
        "Bill to 1789 India Trading GSTIN 10APIPP4518H1Z3",
        "1 500 LTR 4-layer white water tank 39251000 10 EA 4,030.04 9% 9% 47,555.00",
        "Taxable Value 40,300.40",
        "Grand Total 47,554.47",
      ].join("\n"),
    );
    expect(d.invoiceNo).toBe("SQ2604002116");
    expect(d.invoiceDate).toBe("2026-10-10");
    expect(d.sellerGstin).toBe("10AABCA7061K2ZZ");
    expect(d.buyerGstin).toBe("10APIPP4518H1Z3");
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({ hsn: "39251000", qty: "10", ratePaise: 403004, gstRateBp: 1800 });
    expect(d.taxablePaise).toBe(4030040);
    expect(d.totalPaise).toBe(4755447);
  });
});

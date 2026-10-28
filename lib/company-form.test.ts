import { describe, expect, it } from "vitest";
import { mockCompanies } from "@/lib/mock/companies";
import {
  bankLine,
  formFromCompany,
  lrTermsLine,
  patchFromForm,
  sampleFreightBillNo,
  sampleLrNo,
  sampleTaxInvoiceNo,
  validateForm,
} from "./company-form";
import { ifscBankWarning } from "./validators/company";

const acm = { ...mockCompanies[0], nextLrNo: 19021 };

describe("company form", () => {
  it("round-trips a valid company without errors", () => {
    const f = formFromCompany(acm);
    expect(validateForm(f, 19021)).toEqual([]);
    expect(patchFromForm(f)).toMatchObject({ bank: null, podPenaltyPerDay: 5000, nextLrNo: 19021 });
  });

  it("flags bad mobile, GSTIN checksum, PAN mismatch, penalty and a lowered LR number", () => {
    const f = formFromCompany(acm);
    const paths = (patch: Partial<typeof f>) =>
      validateForm({ ...f, ...patch }, 19021).map((e) => e.path);
    expect(paths({ mobile1: "12345" })).toEqual(["mobile1"]);
    expect(paths({ gstin: "10AAXFA2859G1ZE" })).toEqual(["gstin"]);
    expect(paths({ pan: "AAXFA2859H" })).toEqual(["pan"]);
    expect(paths({ podPenalty: "fifty" })).toEqual(["podPenaltyPerDay"]);
    expect(paths({ nextLrNo: "100" })).toEqual(["nextLrNo"]);
    expect(paths({ accountNo: "123" })).toEqual(
      expect.arrayContaining(["bank.accountName", "bank.accountNo", "bank.ifsc"]),
    );
  });

  it("builds live samples and preview lines", () => {
    const f = formFromCompany(acm);
    expect(sampleLrNo({ ...f, lrPrefix: "acm/" }, 19021)).toBe("ACM/19021");
    expect(sampleFreightBillNo("fi-", 7)).toBe("FI-007");
    expect(sampleTaxInvoiceNo("ACM/TI/", 12)).toBe("ACM/TI/012");
    expect(sampleTaxInvoiceNo("ABCDEFGHIJKLMNOP", 1)).toBeNull();
    expect(bankLine(f)).toBe("not set yet");
    expect(lrTermsLine(f)).toBe(
      "POD within 10 days, ₹50/day late · Detention 7 MT ₹1,000/day · 15 MT ₹2,000/day",
    );
  });
});

describe("ifscBankWarning", () => {
  it("warns when the IFSC belongs to another bank", () => {
    expect(ifscBankWarning("HDFC BANK", "HDFC0001234")).toBeNull();
    expect(ifscBankWarning("HDFC Bank Ltd", "SBIN0001234")).toMatch(/HDFC0/);
    expect(ifscBankWarning("State Bank of India", "SBIN0001234")).toBeNull();
    expect(ifscBankWarning("Bank of India", "SBIN0001234")).toMatch(/BKID0/);
    expect(ifscBankWarning("Some Co-op Bank", "ABCD0001234")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { distinctPages } from "./copies";

const body = (n: string) =>
  `Tax Invoice No ${n} dated 28-10-2026 seller ACM LOGISTICS buyer HAVELLS INDIA total 367301.00`;

describe("distinctPages", () => {
  it("keeps only the first of Original / Duplicate / Triplicate copies", () => {
    const pages = [
      `Original for Recipient\n${body("A1")}`,
      `Duplicate for Transporter\n${body("A1")}`,
      `Triplicate for Supplier\n${body("A1")}`,
    ];
    expect(distinctPages(pages)).toEqual([1]);
  });

  it("keeps continuation pages and different invoices", () => {
    expect(distinctPages([body("A1"), "Annexure ".repeat(10) + "page two", body("A2")])).toEqual([
      1, 2, 3,
    ]);
  });

  it("keeps pages without a text layer", () => {
    expect(distinctPages(["", ""])).toEqual([1, 2]);
  });
});

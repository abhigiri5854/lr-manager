import { describe, expect, it } from "vitest";
import { amountInWords, formatDate, formatPaise, formatRupees } from "./format";

describe("formatPaise", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [100000, "1,000.00"],
    [17935600, "1,79,356.00"],
    [18490258, "1,84,902.58"],
    [15669710, "1,56,697.10"],
    [1234567890, "1,23,45,678.90"],
    [-50000, "-500.00"],
  ])("%i → %s", (paise, text) => {
    expect(formatPaise(paise)).toBe(text);
  });

  it("formatRupees adds the ₹ sign", () => {
    expect(formatRupees(18490258)).toBe("₹1,84,902.58");
    expect(formatRupees(-5000)).toBe("-₹50.00");
  });
});

describe("formatDate", () => {
  it("shows dd-mm-yyyy", () => {
    expect(formatDate("2026-10-14")).toBe("14-10-2026");
    expect(formatDate("2026-10-15T18:29:59.000Z")).toBe("15-10-2026");
  });
});

describe("amountInWords", () => {
  it("matches the design's invoice total", () => {
    expect(amountInWords(18490258)).toBe(
      "Rupees One Lakh Eighty-Four Thousand Nine Hundred Two and Fifty-Eight Paise only",
    );
  });

  it.each([
    [0, "Rupees Zero only"],
    [50, "Rupees Zero and Fifty Paise only"],
    [100, "Rupees One only"],
    [1100, "Rupees Eleven only"],
    [100000, "Rupees One Thousand only"],
    [10000000, "Rupees One Lakh only"],
    [17935600, "Rupees One Lakh Seventy-Nine Thousand Three Hundred Fifty-Six only"],
    [1000000000, "Rupees One Crore only"],
    [
      1234567890,
      "Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Ninety Paise only",
    ],
    [
      1234567890000,
      "Rupees One Thousand Two Hundred Thirty-Four Crore Fifty-Six Lakh Seventy-Eight Thousand Nine Hundred only",
    ],
  ])("%i paise", (paise, words) => {
    expect(amountInWords(paise)).toBe(words);
  });

  it("rejects negative and fractional paise", () => {
    expect(() => amountInWords(-1)).toThrow(RangeError);
    expect(() => amountInWords(1.5)).toThrow(RangeError);
  });
});

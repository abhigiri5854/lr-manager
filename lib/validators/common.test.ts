import { describe, expect, it } from "vitest";
import {
  ewayBillNoSchema,
  gstinCheckChar,
  gstinError,
  gstinSchema,
  isValidEwayBillNo,
  isValidGstin,
  isValidMobile,
  isValidPan,
  isValidVehicleNo,
  mobileSchema,
  normaliseMobile,
  normaliseVehicleNo,
  panMatchesGstin,
  vehicleNoSchema,
} from "./common";
import { partyFields, partyRuleErrors } from "./party";

describe("GSTIN", () => {
  it.each([
    "10AABCA7061K2ZZ", // Ashirvad Pipes
    "10FVWPS5035R1ZM", // Maa Vaishno Hardware
    "10APIPP4518H1Z3", // 1789 India Trading
    "10AAXFA2859G1ZD", // ACM Logistics
    "20ABLFR4565P1ZN", // RS Logistics
  ])("accepts design sample %s", (g) => {
    expect(isValidGstin(g)).toBe(true);
  });

  it("flags Modern Sanitation's GSTIN from the design (10AAJFM3446M1ZA) as a checksum failure", () => {
    expect(gstinError("10AAJFM3446M1ZA")).toMatch(/check digit/);
    expect(gstinCheckChar("10AAJFM3446M1Z")).toBe("9");
  });

  it("normalises spaces and case", () => {
    expect(isValidGstin(" 10aabca7061k2zz ")).toBe(true);
    expect(gstinSchema.parse("10aabca 7061k2zz")).toBe("10AABCA7061K2ZZ");
  });

  it("explains wrong length, shape and state code", () => {
    expect(gstinError("10AABCA7061K2Z")).toBe("GSTIN has 14 characters (needs 15)");
    expect(gstinError("10AABC17061K2ZZ")).toBe("GSTIN format is wrong");
    expect(gstinError("40AABCA7061K2ZZ")).toMatch(/state code 40/);
  });

  it("catches a single-character typo via the checksum", () => {
    expect(isValidGstin("10AABCA7061K2ZY")).toBe(false);
    expect(isValidGstin("10AABCA7062K2ZZ")).toBe(false);
  });
});

describe("PAN", () => {
  it("checks format", () => {
    expect(isValidPan("AABCA7061K")).toBe(true);
    expect(isValidPan("aabca7061k")).toBe(true);
    expect(isValidPan("AABCA7061")).toBe(false);
    expect(isValidPan("1ABCA7061K")).toBe(false);
  });

  it("must equal GSTIN characters 3–12", () => {
    expect(panMatchesGstin("AABCA7061K", "10AABCA7061K2ZZ")).toBe(true);
    expect(panMatchesGstin("AAXFA2859G", "10AABCA7061K2ZZ")).toBe(false);
  });

  it("party rules report a PAN / GSTIN mismatch on the pan field", () => {
    expect(partyRuleErrors({ gstin: "10AABCA7061K2ZZ", pan: "AAXFA2859G" })).toEqual([
      { path: "pan", message: "PAN doesn't match GSTIN characters 3–12" },
    ]);
    expect(
      partyRuleErrors({ gstin: "10AABCA7061K2ZZ", pan: "AABCA7061K", stateCode: "10" }),
    ).toEqual([]);
  });

  it("party schema rejects the bad sample GSTIN", () => {
    const r = partyFields.safeParse({ name: "Modern Sanitation", gstin: "10AAJFM3446M1ZA" });
    expect(r.success).toBe(false);
  });
});

describe("vehicle number", () => {
  it.each(["BR01GN8331", "BR06GB7374", "RJ42GA1293", "DL1CAB1234", "MH12AB1234", "22BH1234AB"])(
    "accepts %s",
    (v) => expect(isValidVehicleNo(v)).toBe(true),
  );

  it("normalises spaces, dashes and case to the stored form", () => {
    expect(normaliseVehicleNo("br 01 gn-8331")).toBe("BR01GN8331");
    expect(vehicleNoSchema.parse("Br01 Gn 8331")).toBe("BR01GN8331");
  });

  it.each(["BR01GN833", "B01GN8331", "BR01GN83311", "LR-PRACTICE-001", ""])("rejects %s", (v) => {
    expect(isValidVehicleNo(v)).toBe(false);
  });
});

describe("e-way bill number", () => {
  it("is 12 digits, spaces allowed on input", () => {
    expect(isValidEwayBillNo("801755453075")).toBe(true);
    expect(ewayBillNoSchema.parse("8017 5545 3075")).toBe("801755453075");
    expect(isValidEwayBillNo("80175545307")).toBe(false);
    expect(isValidEwayBillNo("80175545307A")).toBe(false);
  });
});

describe("mobile", () => {
  it("accepts 10 digits starting 6–9 and strips +91 / 0", () => {
    expect(isValidMobile("7870015869")).toBe(true);
    expect(normaliseMobile("+91 78700 15869")).toBe("7870015869");
    expect(normaliseMobile("07870015869")).toBe("7870015869");
    expect(mobileSchema.parse("+91-88737-64100")).toBe("8873764100");
  });

  it("rejects landline-like and short numbers", () => {
    expect(isValidMobile("5870015869")).toBe(false);
    expect(isValidMobile("787001586")).toBe(false);
    expect(isValidMobile("78700158691")).toBe(false);
  });
});

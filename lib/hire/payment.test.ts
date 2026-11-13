import { describe, expect, it } from "vitest";
import {
  calcTruckPayment,
  needsApproval,
  overpayIssues,
  paymentSafeguards,
  type ChallanRoom,
  type SafeguardInput,
} from "./payment";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

describe("calcTruckPayment", () => {
  it("TDS defaults to 0: net = gross", () => {
    const r = calcTruckPayment(undefined, [
      { challanId: A, kind: "balance", grossPaise: 50_000_00, tdsBasePaise: 60_000_00 },
    ]);
    expect(r.issues).toEqual([]);
    expect(r).toMatchObject({ grossPaise: 50_000_00, tdsPaise: 0, netPaise: 50_000_00 });
  });

  it("applies TDS to BALANCE lines only, on the challan gross credit", () => {
    const r = calcTruckPayment("1", [
      { challanId: A, kind: "advance", grossPaise: 10_000_00, tdsBasePaise: 60_000_00 },
      { challanId: B, kind: "balance", grossPaise: 50_000_00, tdsBasePaise: 60_000_00 },
    ]);
    expect(r.issues).toEqual([]);
    expect(r.lines[0]).toMatchObject({ tdsPaise: 0, netPaise: 10_000_00 });
    expect(r.lines[1]).toMatchObject({ tdsPaise: 600_00, netPaise: 49_400_00 });
    expect(r).toMatchObject({ grossPaise: 60_000_00, tdsPaise: 600_00, netPaise: 59_400_00 });
  });

  it("rounds TDS to the paisa (half up)", () => {
    const r = calcTruckPayment("2", [
      { challanId: A, kind: "balance", grossPaise: 1000, tdsBasePaise: 12_345 },
    ]);
    // 123.45 × 2% = 2.469 → 2.47
    expect(r.lines[0].tdsPaise).toBe(247);
  });

  it("accepts fractional percents", () => {
    const r = calcTruckPayment("0.75", [
      { challanId: A, kind: "balance", grossPaise: 100_000, tdsBasePaise: 100_000 },
    ]);
    expect(r.lines[0].tdsPaise).toBe(750);
  });

  it("refuses TDS on a payment with no balance line", () => {
    const r = calcTruckPayment("1", [
      { challanId: A, kind: "advance", grossPaise: 100_00, tdsBasePaise: 100_00 },
    ]);
    expect(r.issues.map((i) => i.path)).toContain("tdsPercent");
    expect(r.tdsPaise).toBe(0);
  });

  it("refuses TDS over 100% and junk percents", () => {
    expect(calcTruckPayment("101", []).issues[0].path).toBe("tdsPercent");
    expect(calcTruckPayment("abc", []).issues[0].path).toBe("tdsPercent");
  });

  it("refuses zero / negative / fractional-paise amounts", () => {
    const r = calcTruckPayment(0, [
      { challanId: A, kind: "advance", grossPaise: 0, tdsBasePaise: 0 },
      { challanId: B, kind: "advance", grossPaise: -5, tdsBasePaise: 0 },
    ]);
    expect(r.issues.map((i) => i.path)).toEqual(["allocations.0.amount", "allocations.1.amount"]);
  });

  it("refuses TDS bigger than the balance line", () => {
    const r = calcTruckPayment("10", [
      { challanId: A, kind: "balance", grossPaise: 500_00, tdsBasePaise: 60_000_00 },
    ]);
    expect(r.issues[0]).toMatchObject({ path: "allocations.0.amount" });
  });

  it("refuses the same challan + kind twice", () => {
    const r = calcTruckPayment(0, [
      { challanId: A, kind: "advance", grossPaise: 100, tdsBasePaise: 0 },
      { challanId: A, kind: "advance", grossPaise: 100, tdsBasePaise: 0 },
    ]);
    expect(r.issues[0].path).toBe("allocations.1.kind");
  });

  it("allows advance + balance on the same challan", () => {
    const r = calcTruckPayment(0, [
      { challanId: A, kind: "advance", grossPaise: 100, tdsBasePaise: 0 },
      { challanId: A, kind: "balance", grossPaise: 100, tdsBasePaise: 0 },
    ]);
    expect(r.issues).toEqual([]);
  });
});

describe("overpayIssues", () => {
  const room = (r: Partial<ChallanRoom> = {}): Map<string, ChallanRoom> =>
    new Map([
      [A, { challanNo: "C-1", payablePaise: 60_000_00, committedPaise: 0, tdsTakenPaise: 0, ...r }],
    ]);
  const line = (grossPaise: number, tdsPaise = 0, kind: "advance" | "balance" = "advance") => ({
    challanId: A,
    kind,
    grossPaise,
    tdsBasePaise: 0,
    tdsPaise,
    netPaise: grossPaise - tdsPaise,
  });

  it("allows paying exactly what is left", () => {
    expect(overpayIssues([line(40_000_00)], room({ committedPaise: 20_000_00 }))).toEqual([]);
  });

  it("blocks one paisa over (drafts and pending payments count as committed)", () => {
    const issues = overpayIssues([line(40_000_01)], room({ committedPaise: 20_000_00 }));
    expect(issues[0].message).toContain("only ₹40,000.00 left");
  });

  it("sums advance + balance lines on the same challan", () => {
    const issues = overpayIssues(
      [line(30_000_00), { ...line(30_000_01, 0, "balance") }],
      room(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("allocations.0.amount");
  });

  it("says nothing is left when fully committed", () => {
    expect(overpayIssues([line(1)], room({ committedPaise: 60_000_00 }))[0].message).toContain(
      "nothing left",
    );
  });

  it("blocks a second TDS deduction on a challan", () => {
    const issues = overpayIssues([line(1000_00, 100_00, "balance")], room({ tdsTakenPaise: 600_00 }));
    expect(issues[0].message).toContain("TDS is already deducted");
  });
});

describe("needsApproval", () => {
  it("off when the limit is null", () => expect(needsApproval(1_00_000_00, null)).toBe(false));
  it("0 = every payment", () => expect(needsApproval(1, 0)).toBe(true));
  it("only above the limit", () => {
    expect(needsApproval(25_000_00, 25_000_00)).toBe(false);
    expect(needsApproval(25_000_01, 25_000_00)).toBe(true);
  });
});

describe("paymentSafeguards", () => {
  const base: SafeguardInput = {
    mode: "bank",
    netPaise: 10_000_00,
    tdsPaise: 0,
    hasBalance: false,
    payee: {
      verified: true,
      blacklisted: false,
      pan: "ABCPD1234E",
      bankChangedAt: null,
      hasBankDetails: true,
    },
    hasUpiTarget: false,
    now: new Date("2026-11-10T10:00:00Z"),
    coolingHours: null,
    cashLimitPaise: 10_000_00,
    declarationOnFile: true,
    balanceBeforePod: [],
    podOverrideReason: null,
    duplicates: [],
    confirmDuplicate: false,
    canApprove: false,
  };
  const run = (p: Partial<SafeguardInput>) => paymentSafeguards({ ...base, ...p });
  const codes = (p: Partial<SafeguardInput>) => run(p).warnings.map((w) => w.code);

  it("clean payment: no warnings, no blocks", () => {
    expect(run({})).toEqual({ warnings: [], blocks: [], needsApprover: false });
  });

  it("blocks a duplicate unless confirmed", () => {
    expect(run({ duplicates: ["TP-7"] }).blocks[0].path).toBe("confirmDuplicate");
    const ok = run({ duplicates: ["TP-7"], confirmDuplicate: true });
    expect(ok.blocks).toEqual([]);
    expect(ok.warnings[0].code).toBe("duplicate");
  });

  it("bank change inside the cooling period blocks, unless the user can approve", () => {
    const changed = "2026-11-09T12:00:00Z"; // 22 h ago, cooling 48 h
    const payee = { ...base.payee, bankChangedAt: changed };
    expect(run({ payee, coolingHours: 48 }).blocks[0].path).toBe("mode");
    expect(run({ payee, coolingHours: 48, canApprove: true }).blocks).toEqual([]);
    expect(codes({ payee, coolingHours: 48, canApprove: true })).toEqual(["bank_changed"]);
  });

  it("bank change after the cooling period, or for cash, is fine", () => {
    const payee = { ...base.payee, bankChangedAt: "2026-11-01T00:00:00Z" };
    expect(run({ payee, coolingHours: 48 }).blocks).toEqual([]);
    const recent = { ...base.payee, bankChangedAt: "2026-11-10T09:00:00Z" };
    expect(run({ payee: recent, coolingHours: 48, mode: "cash", netPaise: 100 }).blocks).toEqual([]);
  });

  it("cooling null (default) or 0 = off: no check at all", () => {
    const recent = { ...base.payee, bankChangedAt: "2026-11-10T09:59:00Z" };
    for (const coolingHours of [null, 0]) {
      expect(run({ payee: recent, coolingHours })).toEqual({ warnings: [], blocks: [], needsApprover: false });
      expect(run({ payee: recent, coolingHours, mode: "upi", hasUpiTarget: true }).blocks).toEqual([]);
    }
  });

  it("bank mode without account / IFSC warns, never blocks", () => {
    const r = run({ payee: { ...base.payee, hasBankDetails: false } });
    expect(r.blocks).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(["no_bank_details"]);
    expect(codes({ mode: "cash", netPaise: 100, payee: { ...base.payee, hasBankDetails: false } })).toEqual([]);
  });

  it("UPI without an ID or QR warns, never blocks", () => {
    const r = run({ mode: "upi", hasUpiTarget: false });
    expect(r.blocks).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(["no_upi_target"]);
    expect(codes({ mode: "upi", hasUpiTarget: true })).toEqual([]);
  });

  it("unverified warns, blacklisted blocks", () => {
    expect(codes({ payee: { ...base.payee, verified: false } })).toEqual(["payee_unverified"]);
    expect(run({ payee: { ...base.payee, blacklisted: true } }).blocks[0].path).toBe("payeePartyId");
  });

  it("cash over the limit warns", () => {
    expect(codes({ mode: "cash", netPaise: 10_000_01 })).toEqual(["cash_limit"]);
    expect(codes({ mode: "cash", netPaise: 10_000_00 })).toEqual([]);
    expect(codes({ mode: "cash", netPaise: 99_000_00, cashLimitPaise: null })).toEqual([]);
  });

  it("balance before POD needs a reason; a non-approver is routed to approval", () => {
    expect(run({ balanceBeforePod: ["C-1"] }).blocks[0].path).toBe("podOverrideReason");
    const staff = run({ balanceBeforePod: ["C-1"], podOverrideReason: "Owner asked" });
    expect(staff.blocks).toEqual([]);
    expect(staff.needsApprover).toBe(true);
    expect(staff.warnings[0].code).toBe("balance_before_pod");
    const owner = run({ balanceBeforePod: ["C-1"], podOverrideReason: "x", canApprove: true });
    expect(owner.needsApprover).toBe(false);
  });

  it("TDS without a PAN warns; missing declaration warns on balance payments", () => {
    expect(codes({ tdsPaise: 100, payee: { ...base.payee, pan: null } })).toEqual(["tds_no_pan"]);
    expect(codes({ hasBalance: true, declarationOnFile: false })).toEqual(["no_tds_declaration"]);
    expect(codes({ hasBalance: false, declarationOnFile: false })).toEqual([]);
  });
});

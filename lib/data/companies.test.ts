import { beforeEach, describe, expect, it, vi } from "vitest";
import { gstinCheckChar } from "@/lib/validators/common";
import { allocateNumber, db, resetStore } from "./_store";

// Tests run outside a Next.js request, where connection() would throw.
vi.mock("next/server", () => ({ connection: async () => {} }));
import { createCompany, getCompany, getNumbering, listCompanies, updateCompany } from "./companies";
import { ForbiddenError, ValidationError } from "./errors";
import { listParties } from "./parties";
import { uploadCompanyImage } from "./uploads";

const acmId = () => db.companies.find((c) => c.label === "ACM Logistics")!.id;
const ownerId = () => db.memberships.find((m) => m.role === "owner")!.userId;

beforeEach(() => resetStore());

const first14 = "10AABCA7061K1Z";
const input = {
  name: "NEW ROADWAYS",
  label: "New Roadways",
  city: "Gaya",
  gstin: first14 + gstinCheckChar(first14),
  pan: "AABCA7061K",
};

describe("createCompany", () => {
  it("creates the company, self party, number series and Owner membership", async () => {
    const c = await createCompany(input);
    expect((await listCompanies()).map((x) => x.id)).toContain(c.id);
    expect(db.memberships.find((m) => m.companyId === c.id)).toMatchObject({
      userId: ownerId(),
      role: "owner",
    });
    const self = (await listParties(c.id)).rows.find((p) => p.isSelf);
    expect(self).toMatchObject({ name: "NEW ROADWAYS", gstin: c.gstin, stateCode: "10" });
    const series = db.numberSeries.filter((s) => s.companyId === c.id).map((s) => s.series);
    expect(series.sort()).toEqual(["freight_bill", "lr", "tax_invoice"]);
    expect(c.nextLrNo).toBe(1);
  });

  it("rejects a PAN that doesn't match the GSTIN, and a duplicate GSTIN", async () => {
    await expect(createCompany({ ...input, pan: "ZZZZZ9999Z" })).rejects.toThrow(
      /PAN doesn't match/,
    );
    const acm = (await getCompany(acmId()))!;
    await expect(createCompany({ ...input, gstin: acm.gstin, pan: acm.pan })).rejects.toThrow(
      /already exists/,
    );
  });
});

describe("updateCompany", () => {
  it("is Owner only", async () => {
    db.memberships.find((m) => m.companyId === acmId() && m.role === "owner")!.role = "accountant";
    const c = (await getCompany(acmId()))!;
    await expect(updateCompany(acmId(), c.version, { city: "Gaya" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("checks UDYAM, IFSC and account number formats", async () => {
    const c = (await getCompany(acmId()))!;
    const save = (patch: object) => updateCompany(acmId(), c.version, patch);
    const bank = {
      accountName: "A",
      bankName: "HDFC",
      accountNo: "123456789",
      ifsc: "HDFC0001234",
    };
    await expect(save({ udyam: "UDYAM-JH-1-50188" })).rejects.toThrow(/UDYAM/);
    await expect(save({ bank: { ...bank, accountNo: "12345678" } })).rejects.toThrow(/9–18 digits/);
    await expect(save({ bank: { ...bank, ifsc: "HDFC1001234" } })).rejects.toThrow(/IFSC/);
    const saved = await save({ udyam: "udyam - br-01-0012345" });
    expect(saved.udyam).toBe("UDYAM-BR-01-0012345");
  });

  it("raises the LR number but never lowers it", async () => {
    const c = (await getCompany(acmId()))!;
    await expect(updateCompany(acmId(), c.version, { nextLrNo: 19020 })).rejects.toThrow(
      ValidationError,
    );
    const saved = await updateCompany(acmId(), c.version, { nextLrNo: 20000 });
    expect(saved.nextLrNo).toBe(20000);
  });

  it("keeps the self party in step", async () => {
    const c = (await getCompany(acmId()))!;
    await updateCompany(acmId(), c.version, {
      name: "ACM LOGISTICS PVT LTD",
      mobile1: "9876543210",
    });
    const self = (await listParties(acmId())).rows.find((p) => p.isSelf);
    expect(self).toMatchObject({ name: "ACM LOGISTICS PVT LTD", phone: "9876543210" });
  });
});

describe("numbering reset", () => {
  it("restarts bills at 1 in a new FY, or runs on when reset is off", () => {
    allocateNumber(acmId(), "freight_bill", "2025-26");
    allocateNumber(acmId(), "freight_bill", "2025-26");
    expect(allocateNumber(acmId(), "freight_bill", "2026-27")).toBe(1);

    resetStore();
    db.companies.find((c) => c.id === acmId())!.numberingResetsYearly = false;
    allocateNumber(acmId(), "tax_invoice", "2025-26");
    allocateNumber(acmId(), "tax_invoice", "2025-26");
    expect(allocateNumber(acmId(), "tax_invoice", "2026-27")).toBe(3);
  });

  it("reports both possible next numbers for the samples", async () => {
    db.numberSeries.push({
      companyId: acmId(),
      series: "freight_bill",
      fy: "2000-01",
      nextValue: 8,
    });
    const n = await getNumbering(acmId());
    expect(n.freightBill).toEqual({ ifReset: 1, ifRunOn: 8 });
    expect(n.lr).toBe(19021);
  });
});

describe("uploadCompanyImage", () => {
  const png = { name: "logo.png", type: "image/png", bytes: new Uint8Array([1, 2, 3]) };
  it("accepts PNG / SVG / JPG up to 2 MB", async () => {
    const r = await uploadCompanyImage(acmId(), "logo", png);
    expect(r.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\?n=logo\.png$/);
    await expect(
      uploadCompanyImage(acmId(), "logo", { ...png, name: "x.gif", type: "image/gif" }),
    ).rejects.toThrow(/PNG, SVG or JPG/);
    const big = { ...png, bytes: new Uint8Array(2 * 1024 * 1024 + 1) };
    await expect(uploadCompanyImage(acmId(), "signature", big)).rejects.toThrow(/2 MB/);
  });
});

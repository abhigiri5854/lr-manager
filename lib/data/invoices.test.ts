import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetStore } from "./_store";

vi.mock("next/server", () => ({ connection: async () => {} }));
import { updateCompany } from "./companies";
import { ConflictError, ValidationError } from "./errors";
import {
  cancelTaxInvoice,
  createTaxInvoice,
  finaliseTaxInvoice,
  getTaxInvoiceById,
  listTaxInvoices,
  peekNextInvoiceNo,
  updateTaxInvoice,
} from "./invoices";
import { createItem, listItems, searchItems, updateItem } from "./items";
import { createParty } from "./parties";

const acmId = () => db.companies.find((c) => c.label === "ACM Logistics")!.id;
const partyId = (name: string) => db.parties.find((p) => p.name === name)!.id;
const itemId = (code: string) => db.items.find((i) => i.code === code)!.id;
const sq = () => db.taxInvoices.find((i) => i.invoiceNo === "SQ2604002116")!;

const line = {
  description: "500 LTR tank",
  qty: "2",
  ratePaise: 100000,
  gstRateBp: 1800,
};

function draft(extra: Record<string, unknown> = {}) {
  return createTaxInvoice(acmId(), {
    invoiceAt: "2026-10-20T06:00:00.000Z",
    billToId: partyId("1789 India Trading"),
    lines: [line],
    ...extra,
  });
}

beforeEach(() => resetStore());

describe("own tax invoices", () => {
  it("saves a draft with no number and intra-state CGST + SGST with round-off", async () => {
    const inv = await draft({ lines: [{ ...line, ratePaise: 100033 }] });
    expect(inv.invoiceNo).toBeNull();
    expect(inv.status).toBe("draft");
    expect(inv.placeOfSupplyStateCode).toBe("10");
    // 2 × 1,000.33 = 2,000.66; 9% = 180.0594 → 180.06 each
    expect(inv.totals).toEqual({
      taxablePaise: 200066,
      sgstPaise: 18006,
      cgstPaise: 18006,
      igstPaise: 0,
      roundOffPaise: 22, // 2,360.78 → 2,361.00
      totalPaise: 236100,
    });
  });

  it("charges IGST when the ship-to party is in another state", async () => {
    const jh = await createParty(acmId(), { name: "Ranchi Traders", stateCode: "20" });
    const inv = await draft({ shipToId: jh.id });
    expect(inv.placeOfSupplyStateCode).toBe("20");
    expect(inv.totals).toMatchObject({ sgstPaise: 0, igstPaise: 36000, totalPaise: 236000 });
  });

  it("needs a state for an unregistered buyer without one", async () => {
    const walkIn = await createParty(acmId(), { name: "Walk-in buyer" });
    await expect(draft({ billToId: walkIn.id })).rejects.toThrow("Choose the buyer's state");
    const inv = await draft({ billToId: walkIn.id, placeOfSupplyStateCode: "09" });
    expect(inv.totals.igstPaise).toBe(36000);
  });

  it("allocates gapless numbers per financial year on Finalise and locks the invoice", async () => {
    expect(await peekNextInvoiceNo(acmId(), "2026-10-20")).toMatchObject({
      invoiceNo: "ACM/TI/001",
      fy: "2026-27",
    });
    const a = await draft();
    const b = await draft();
    const fa = await finaliseTaxInvoice(acmId(), a.id, a.version);
    const fb = await finaliseTaxInvoice(acmId(), b.id, b.version);
    expect([fa.invoiceNo, fb.invoiceNo]).toEqual(["ACM/TI/001", "ACM/TI/002"]);
    expect(fa.status).toBe("final");
    expect(fa.snapshot?.billTo.name).toBe("1789 India Trading");
    await expect(updateTaxInvoice(acmId(), fa.id, fa.version, { soNo: "X" })).rejects.toThrow(
      "Finalised invoices can't be edited",
    );

    // April starts a new financial year at 001.
    const next = await draft({ invoiceAt: "2027-04-02T06:00:00.000Z" });
    const fn = await finaliseTaxInvoice(acmId(), next.id, next.version);
    expect(fn.invoiceNo).toBe("ACM/TI/001");
  });

  it("doesn't use up a number when Finalise fails", async () => {
    const co = db.companies.find((c) => c.id === acmId())!;
    co.taxInvoicePrefix = "ACM/TAX/26-27/"; // 14 + 3 digits = 17 > 16
    const a = await draft();
    await expect(finaliseTaxInvoice(acmId(), a.id, a.version)).rejects.toThrow("16 characters");
    co.taxInvoicePrefix = "ACM/TI/";
    const fa = await finaliseTaxInvoice(acmId(), a.id, a.version);
    expect(fa.invoiceNo).toBe("ACM/TI/001");
  });

  it("checks expectedVersion", async () => {
    const a = await draft();
    await updateTaxInvoice(acmId(), a.id, a.version, { soNo: "1" });
    await expect(updateTaxInvoice(acmId(), a.id, a.version, { soNo: "2" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("cancels with a reason and keeps the number used", async () => {
    const a = await draft();
    const fa = await finaliseTaxInvoice(acmId(), a.id, a.version);
    await expect(cancelTaxInvoice(acmId(), fa.id, " ")).rejects.toThrow(ValidationError);
    const c = await cancelTaxInvoice(acmId(), fa.id, "Wrong buyer");
    expect(c.cancelReason).toBe("Wrong buyer");
    expect(c.invoiceNo).toBe("ACM/TI/001");
    const b = await draft();
    expect((await finaliseTaxInvoice(acmId(), b.id, b.version)).invoiceNo).toBe("ACM/TI/002");
    const cancelled = await listTaxInvoices(acmId(), { status: "cancelled" });
    expect(cancelled.rows.map((r) => r.invoiceNo)).toEqual(["ACM/TI/001"]);
  });

  it("remembers the last rate on the item master when finalised", async () => {
    const id = itemId("70004162");
    const a = await draft({ lines: [{ ...line, itemId: id, ratePaise: 410000 }] });
    await finaliseTaxInvoice(acmId(), a.id, a.version);
    expect(db.items.find((i) => i.id === id)!.lastRatePaise).toBe(410000);
  });

  it("rejects GST rates outside the allowed set", async () => {
    await expect(draft({ lines: [{ ...line, gstRateBp: 1000 }] })).rejects.toThrow(ValidationError);
  });
});

describe("imported invoices", () => {
  it("keep the seller's number on Finalise and never touch our series", async () => {
    const inv = sq();
    const f = await finaliseTaxInvoice(acmId(), inv.id, inv.version);
    expect(f.invoiceNo).toBe("SQ2604002116");
    expect(db.numberSeries.some((s) => s.series === "tax_invoice")).toBe(false);
  });

  it("require their number", async () => {
    const inv = sq();
    await expect(updateTaxInvoice(acmId(), inv.id, inv.version, { invoiceNo: "" })).rejects.toThrow(
      "Enter the seller's invoice number",
    );
  });

  it("still reproduce SQ2604002116 to the paisa when re-priced, ignoring our round-off", async () => {
    const inv = sq();
    const u = await updateTaxInvoice(acmId(), inv.id, inv.version, { doNo: "801445107" });
    expect(u.totals.totalPaise).toBe(18490258);
  });
});

describe("invoice list", () => {
  it("searches by number, party and GSTIN and filters by status, date and party", async () => {
    await draft();
    expect((await listTaxInvoices(acmId())).total).toBe(2);
    expect((await listTaxInvoices(acmId(), { search: "sq2604" })).total).toBe(1);
    expect((await listTaxInvoices(acmId(), { search: "10APIPP4518H1Z3" })).total).toBe(2);
    expect((await listTaxInvoices(acmId(), { status: "final" })).total).toBe(0);
    expect((await listTaxInvoices(acmId(), { from: "2026-10-15" })).total).toBe(1);
    expect((await listTaxInvoices(acmId(), { to: "2026-10-10" })).total).toBe(1);
    const r = await listTaxInvoices(acmId(), { partyId: partyId("Ashirvad Pipes Pvt Ltd") });
    expect(r.rows[0].billToName).toBe("1789 India Trading");
    expect(r.rows[0].linkedLrs.map((l) => l.lrNo)).toEqual(["19020"]);
    expect(await getTaxInvoiceById(acmId(), r.rows[0].id)).not.toBeNull();
  });
});

describe("company invoice settings", () => {
  it("validates the prefix", async () => {
    const co = db.companies.find((c) => c.id === acmId())!;
    await expect(
      updateCompany(acmId(), co.version, { taxInvoicePrefix: "ACM TI" }),
    ).rejects.toThrow("A-Z, 0-9");
    await expect(
      updateCompany(acmId(), co.version, { taxInvoicePrefix: "ABCDEFGHIJKLM" }),
    ).rejects.toThrow("at most 12");
    const saved = await updateCompany(acmId(), co.version, {
      taxInvoicePrefix: "acm-ti/",
      invoiceRoundOff: false,
    });
    expect(saved.taxInvoicePrefix).toBe("ACM-TI/");
    expect(saved.invoiceRoundOff).toBe(false);
  });
});

describe("item master", () => {
  it("adds, finds and edits items with a unique code", async () => {
    const it1 = await createItem(acmId(), {
      code: "p-100",
      name: "PVC pipe 100mm",
      hsn: "3917",
      uom: "mtr",
      gstRateBp: 1800,
    });
    expect(it1).toMatchObject({ code: "P-100", uom: "MTR" });
    await expect(createItem(acmId(), { code: "P-100", name: "Dup" })).rejects.toThrow(
      "already saved",
    );
    await expect(createItem(acmId(), { name: "Bad", hsn: "12" })).rejects.toThrow("4–8 digits");
    expect((await searchItems(acmId(), "p-1"))[0].id).toBe(it1.id);
    expect((await searchItems(acmId(), "4-layer")).length).toBe(2);
    const u = await updateItem(acmId(), it1.id, it1.version, { gstRateBp: 2800 });
    expect(u.gstRateBp).toBe(2800);
    await expect(updateItem(acmId(), it1.id, it1.version, { name: "x" })).rejects.toThrow(
      ConflictError,
    );
    expect((await listItems(acmId(), { search: "3917" })).total).toBe(1);
  });
});

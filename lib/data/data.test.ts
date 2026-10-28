import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetStore } from "./_store";

// Tests run outside a Next.js request, where connection() would throw.
vi.mock("next/server", () => ({ connection: async () => {} }));
import {
  createFreightBill,
  createPayment,
  finaliseFreightBill,
  getFreightBillById,
  listUnbilledLrs,
} from "./bills";
import { getCompany, listCompanies, updateCompany } from "./companies";
import { ConflictError, ValidationError } from "./errors";
import { getTaxInvoiceById, listLrsForInvoice, listTaxInvoices } from "./invoices";
import {
  bookLr,
  cancelLr,
  createLr,
  findLrsWithInvoice,
  getConsigneeToPlace,
  getConsignorDefaults,
  getLrById,
  listLrs,
  listLrsForExport,
  peekNextLrNo,
  updateLr,
} from "./lrs";
import { createParty, findPartyByGstin, listParties, updateParty } from "./parties";
import { createPod, listPodPending } from "./pod";
import { findTruckByNumber, listTruckSuggestions, listTrucks } from "./trucks";

// Sample ids are looked up by business key so the test doesn't import lib/mock.
const acmId = () => db.companies.find((c) => c.label === "ACM Logistics")!.id;
const rsId = () => db.companies.find((c) => c.label === "RS Logistics")!.id;
const lrId = (no: string) => db.lrs.find((l) => l.lrNo === no)!.id;
const partyId = (name: string) => db.parties.find((p) => p.name === name)!.id;

beforeEach(() => resetStore());

describe("company scoping", () => {
  it("only returns the asked company's rows", async () => {
    expect((await listLrs(acmId())).total).toBe(2);
    expect((await listLrs(rsId())).total).toBe(0);
    expect((await listParties(rsId())).total).toBe(0);
    expect(await getLrById(rsId(), lrId("19019"))).toBeNull();
  });

  it("rejects references to another company's records", async () => {
    await expect(
      createLr(rsId(), { consignorId: partyId("Ashirvad Pipes Pvt Ltd") }),
    ).rejects.toThrow(ValidationError);
  });

  it("lists both companies for the owner", async () => {
    expect((await listCompanies()).map((c) => c.label)).toEqual(["ACM Logistics", "RS Logistics"]);
  });
});

describe("sample LRs", () => {
  it("derive status and display fields", async () => {
    const lr19019 = (await getLrById(acmId(), lrId("19019")))!;
    expect(lr19019.status).toBe("In transit");
    expect(lr19019.truckNumber).toBe("BR01GN8331");
    expect(lr19019.totalPackages).toBe(28);
    expect(lr19019.totalValuePaise).toBe(17935600);
    const lr19020 = (await getLrById(acmId(), lrId("19020")))!;
    expect(lr19020.status).toBe("Draft");
    expect(lr19020.totalPackages).toBe(25);
  });

  it("search and filters", async () => {
    expect((await listLrs(acmId(), { search: "maa vaishno" })).rows.map((r) => r.lrNo)).toEqual([
      "19019",
    ]);
    expect((await listLrs(acmId(), { search: "SQ2604002116" })).rows.map((r) => r.lrNo)).toEqual([
      "19020",
    ]);
    expect((await listLrs(acmId(), { status: "Draft" })).total).toBe(1);
  });

  it("finds the LR that carries invoice SQ2604002116", async () => {
    const inv = (await listTaxInvoices(acmId())).rows[0];
    expect((await getTaxInvoiceById(acmId(), inv.id))!.totals.totalPaise).toBe(18490258);
    expect((await listLrsForInvoice(acmId(), inv.id)).map((l) => l.lrNo)).toEqual(["19020"]);
  });
});

describe("LR register filters", () => {
  const lrNos = async (params: Parameters<typeof listLrs>[1]) =>
    (await listLrs(acmId(), params)).rows.map((r) => r.lrNo);

  it("finds a truck typed with spaces", async () => {
    expect(await lrNos({ search: "br 01 gn" })).toEqual(["19019"]);
  });

  it("filters by date range, skipping LRs with no date", async () => {
    expect(await lrNos({ dateFrom: "2026-10-14", dateTo: "2026-10-14" })).toEqual(["19019"]);
    expect(await lrNos({ dateFrom: "2026-10-15" })).toEqual([]);
  });

  it("cancels with a reason and hides the LR unless filtering for Cancelled", async () => {
    await expect(cancelLr(acmId(), lrId("19020"), { reason: " " })).rejects.toThrow(
      ValidationError,
    );
    const lr = await cancelLr(acmId(), lrId("19020"), { reason: "Duplicate entry" });
    expect(lr.status).toBe("Cancelled");
    expect(lr.cancelReason).toBe("Duplicate entry");
    expect(await lrNos({})).toEqual(["19019"]);
    expect(await lrNos({ status: "Cancelled" })).toEqual(["19020"]);
    const audit = db.audit.findLast((a) => a.recordId === lrId("19020"))!;
    expect(audit.action).toBe("cancel");
    expect(audit.changes.some((c) => c.field === "cancelReason")).toBe(true);
  });

  it("exports every matching row, not just one page", async () => {
    const all = await listLrsForExport(acmId(), {});
    expect(all.total).toBe(2);
    expect((await listLrsForExport(acmId(), { search: "19020" })).rows.map((r) => r.lrNo)).toEqual([
      "19020",
    ]);
  });
});

describe("numbering", () => {
  it("allocates LR numbers from the series on create", async () => {
    expect((await getCompany(acmId()))!.nextLrNo).toBe(19021);
    expect((await createLr(acmId(), {})).lrNo).toBe("19021");
    expect((await createLr(acmId(), {})).lrNo).toBe("19022");
    expect((await getCompany(acmId()))!.nextLrNo).toBe(19023);
  });

  it("refuses an LR until the company sets its numbering", async () => {
    await expect(createLr(rsId(), {})).rejects.toThrow(/next LR number/);
  });

  it("won't move the LR series backwards", async () => {
    const c = (await getCompany(acmId()))!;
    await expect(updateCompany(acmId(), c.version, { nextLrNo: 100 })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("updates", () => {
  it("bump the version and fail on a stale version", async () => {
    const id = partyId("1789 India Trading");
    const saved = await updateParty(acmId(), id, 1, { place: "Motihari, Bihar" });
    expect(saved.version).toBe(2);
    await expect(updateParty(acmId(), id, 1, { place: "x" })).rejects.toThrow(ConflictError);
  });

  it("write the audit log with old → new", async () => {
    await updateParty(acmId(), partyId("1789 India Trading"), 1, { phone: "9199835233" });
    const entry = db.audit.at(-1)!;
    expect(entry.action).toBe("update");
    expect(entry.changes).toEqual([{ field: "phone", old: "9199835232", new: "9199835233" }]);
  });

  it("enforce unique GSTIN and truck numbers per company", async () => {
    await expect(createParty(acmId(), { name: "Copy", gstin: "10AABCA7061K2ZZ" })).rejects.toThrow(
      /already saved/,
    );
    expect(await findPartyByGstin(acmId(), "10aabca7061k2zz")).not.toBeNull();
    expect((await findTruckByNumber(acmId(), "br 01 gn 8331"))!.driverMobile).toBe("7870015869");
    expect((await listTrucks(acmId(), { search: "8331" })).total).toBe(1);
  });

  it("fills PAN and state from GSTIN for a new party", async () => {
    const p = await createParty(rsId(), { name: "New Co", gstin: "20ABLFR4565P1ZN" });
    expect(p.pan).toBe("ABLFR4565P");
    expect(p.stateCode).toBe("20");
  });
});

describe("LR → POD → bill → paid", () => {
  it("walks the whole lifecycle", async () => {
    const co = acmId();
    const id = lrId("19019");

    await createPod(co, { lrId: id, deliveredOn: "2026-10-16" });
    expect((await getLrById(co, id))!.status).toBe("Delivered");
    expect((await listPodPending(co)).map((r) => r.lrNo)).toEqual(["19019"]);

    expect((await listUnbilledLrs(co)).map((l) => l.lrNo)).toEqual(["19019"]);
    const draft = await createFreightBill(co, {
      billDate: "2026-10-27",
      partyId: partyId("Ashirvad Pipes Pvt Ltd"),
      gstMode: "reverse_charge",
      lines: [{ lrId: id, freightPaise: 2500000, advancePaise: 500000 }],
    });
    expect(draft.billNo).toBeNull();
    expect(draft.totals.amountPaise).toBe(2000000);
    expect((await getLrById(co, id))!.status).toBe("Delivered"); // draft bill doesn't bill the LR

    const final = await finaliseFreightBill(co, draft.id, draft.version);
    expect(final.billNo).toBe("ACM/FB/26-27/001");
    expect((await getLrById(co, id))!.status).toBe("Billed");
    const lr = (await getLrById(co, id))!;
    await expect(updateLr(co, id, lr.version, { remarks: "x" })).rejects.toThrow(/locked/);
    await expect(cancelLr(co, id, { reason: "Booked twice" })).rejects.toThrow(ValidationError);

    await expect(
      createPayment(co, {
        partyId: partyId("Ashirvad Pipes Pvt Ltd"),
        amountPaise: 3000000,
        mode: "neft_upi",
        receivedOn: "2026-11-05",
        allocations: [{ freightBillId: final.id, amountPaise: 2500000 }],
      }),
    ).rejects.toThrow(/due on bill/);

    await createPayment(co, {
      partyId: partyId("Ashirvad Pipes Pvt Ltd"),
      amountPaise: 1960000,
      tdsPaise: 40000,
      mode: "neft_upi",
      receivedOn: "2026-11-05",
      allocations: [{ freightBillId: final.id, amountPaise: 2000000 }],
    });
    expect((await getFreightBillById(co, final.id))!.duePaise).toBe(0);
    expect((await getLrById(co, id))!.status).toBe("Paid");
  });

  it("won't book a draft that is missing required fields", async () => {
    const lr = await createLr(acmId(), { fromPlace: "Painal" });
    await expect(bookLr(acmId(), lr.id, lr.version)).rejects.toThrow(/LR date is required/);
  });
});

describe("New / Edit LR form", () => {
  const bookable = () => ({
    lrDate: "2026-10-28",
    fromPlace: "Painal",
    toPlace: "Motihari",
    consignorId: partyId("Ashirvad Pipes Pvt Ltd"),
    consigneeId: partyId("1789 India Trading"),
    paymentMode: "tbb" as const,
    items: [{ description: "Water tank", packages: 10 }],
  });

  it("peeks the next LR number without taking it", async () => {
    expect(await peekNextLrNo(acmId(), "2026-10-28")).toBe("19021");
    expect(await peekNextLrNo(acmId(), "2026-10-28")).toBe("19021");
    // A new financial year carries on from the latest series, like allocation does.
    expect(await peekNextLrNo(acmId(), "2027-05-01")).toBe("19021");
    expect(await peekNextLrNo(rsId())).toBeNull();
  });

  it("creates and books in one go, with a snapshot", async () => {
    const lr = await createLr(acmId(), bookable(), { book: true });
    expect(lr.lrNo).toBe("19021");
    expect(lr.status).toBe("Booked");
    expect(lr.snapshot?.consignor?.name).toBe("Ashirvad Pipes Pvt Ltd");
  });

  it("refuses to book an incomplete LR without using up a number", async () => {
    await expect(createLr(acmId(), { fromPlace: "Painal" }, { book: true })).rejects.toThrow(
      /LR date is required/,
    );
    expect(await peekNextLrNo(acmId(), "2026-10-28")).toBe("19021");
  });

  it("books a draft on update and still checks the version", async () => {
    const draft = await createLr(acmId(), { fromPlace: "Painal" });
    await expect(updateLr(acmId(), draft.id, 99, bookable(), { book: true })).rejects.toThrow(
      ConflictError,
    );
    const booked = await updateLr(acmId(), draft.id, draft.version, bookable(), { book: true });
    expect(booked.status).toBe("Booked");
    expect(booked.lrNo).toBe(draft.lrNo);
    expect(booked.snapshot?.consignee?.name).toBe("1789 India Trading");
  });

  it("fills consignor defaults from their latest booked LR, else the party's settings", async () => {
    const d = await getConsignorDefaults(acmId(), partyId("Ashirvad Pipes Pvt Ltd"));
    expect(d).toMatchObject({ lrNo: "19019", fromPlace: "Painal", chargedAs: "ftl" });
    expect(await getConsignorDefaults(acmId(), partyId("Maa Vaishno Hardware"))).toBeNull();
    const p = await createParty(acmId(), { name: "New Co", defaultFrom: "Bihta" });
    expect(await getConsignorDefaults(acmId(), p.id)).toMatchObject({
      lrNo: null,
      fromPlace: "Bihta",
    });
  });

  it("suggests trucks with their latest LR", async () => {
    const [t] = await listTruckSuggestions(acmId(), "br 06");
    expect(t).toMatchObject({
      number: "BR06GB7374",
      driverMobile: "8873764100",
      lastLrNo: "19020",
    });
  });
});

describe("duplicate goods invoices", () => {
  const sq = () => db.taxInvoices.find((i) => i.invoiceNo === "SQ2604002116")!.id;

  it("finds the LR that carries a tax invoice, by link or by invoice no.", async () => {
    expect(await findLrsWithInvoice(acmId(), { taxInvoiceId: sq() })).toEqual([
      { id: lrId("19020"), lrNo: "19020" },
    ]);
    // Typed with spaces / lower case still matches.
    expect(await findLrsWithInvoice(acmId(), { invoiceNo: " sq2604 002116" })).toEqual([
      { id: lrId("19020"), lrNo: "19020" },
    ]);
    expect(await findLrsWithInvoice(acmId(), { invoiceNo: "182604002150" })).toEqual([
      { id: lrId("19019"), lrNo: "19019" },
    ]);
  });

  it("finds nothing for a new number, a blank number or another company", async () => {
    expect(await findLrsWithInvoice(acmId(), { invoiceNo: "NEW-1" })).toEqual([]);
    expect(await findLrsWithInvoice(acmId(), { invoiceNo: "  " })).toEqual([]);
    expect(await findLrsWithInvoice(rsId(), { invoiceNo: "SQ2604002116" })).toEqual([]);
  });

  it("leaves out the LR being edited", async () => {
    expect(await findLrsWithInvoice(acmId(), { invoiceNo: "SQ2604002116" }, lrId("19020"))).toEqual(
      [],
    );
  });

  it("ignores cancelled LRs", async () => {
    await cancelLr(acmId(), lrId("19020"), { reason: "Booked twice" });
    expect(await findLrsWithInvoice(acmId(), { taxInvoiceId: sq() })).toEqual([]);
  });

  it("lists every LR carrying the invoice, newest first", async () => {
    const lr = await createLr(acmId(), {
      lrInvoices: [{ invoiceNo: "SQ2604002116", taxInvoiceId: sq() }],
    });
    expect((await findLrsWithInvoice(acmId(), { taxInvoiceId: sq() })).map((l) => l.lrNo)).toEqual([
      lr.lrNo,
      "19020",
    ]);
  });
});

describe("consignee To place", () => {
  it("uses their last booked LR, else the party's place", async () => {
    expect(await getConsigneeToPlace(acmId(), partyId("Maa Vaishno Hardware"))).toBe(
      "Gaighat (MUZ)",
    );
    expect(await getConsigneeToPlace(acmId(), partyId("1789 India Trading"))).toBe("Motihari");
  });
});

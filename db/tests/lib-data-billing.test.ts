// Tax invoices, freight bills, payments, Smart import and the dashboard's money on the database
// (prompt 19c): the real lib/data functions, signed in through the session cookie, against the
// dev database. Each test makes its own company and users.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Fixtures, connect, type Sql } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

process.env.DATA_SOURCE = "db";

const session = await import("@/lib/data/session");
const invoices = await import("@/lib/data/invoices");
const bills = await import("@/lib/data/bills");
const lrs = await import("@/lib/data/lrs");
const imports = await import("@/lib/data/import");
const dashboard = await import("@/lib/data/dashboard");
const { formToInvoiceInput } = await import("@/lib/invoice-form");
const { ConflictError } = await import("@/lib/data/errors");

let sql: Sql;
let fx: Fixtures;

beforeAll(() => {
  sql = connect();
  fx = new Fixtures(sql);
});
afterEach(() => fx.cleanup());
afterAll(async () => {
  await sql.end();
  const g = globalThis as { __lrmSql?: { end: () => Promise<void> } };
  await g.__lrmSql?.end();
});

function signIn(userId: string, companyId?: string) {
  jar.clear();
  jar.set(session.SESSION_COOKIE, session.sessionCookieValue(userId));
  if (companyId) jar.set("lrm_company", companyId);
}

const invoiceAt = "2026-10-14T06:30:00.000Z";

describe("tax invoices on the database", () => {
  it("draft → edit → finalise (number, snapshot, item rate) → cancel; imported numbers stay unique", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const buyer = await fx.party(t.companyId, "Bharat Buyers");
    const seller = await fx.party(t.companyId, "Sona Sellers");
    const [item] = await sql`insert into items (company_id, code, name, gst_rate_bp)
                             values (${t.companyId}, 'PIPE', 'Pipe', 1800) returning id`;
    const line = { itemId: item.id, description: "Pipe 20mm", qty: "10", ratePaise: 100_00, gstRateBp: 1800 };

    const draft = await invoices.createTaxInvoice(t.companyId, {
      invoiceAt,
      billToId: buyer,
      lines: [line],
    });
    expect(draft).toMatchObject({ status: "draft", invoiceNo: null, version: 1 });
    expect(draft.totals).toMatchObject({ taxablePaise: 1000_00, sgstPaise: 90_00, cgstPaise: 90_00 });
    expect(draft.lines[0].qty).toBe("10.000");
    expect(await invoices.getTaxInvoiceById(t.companyId, draft.id)).toEqual(draft);

    const list = await invoices.listTaxInvoices(t.companyId, { search: "bharat" });
    expect(list.total).toBe(1);
    expect(list.rows[0]).toMatchObject({ billToName: "Bharat Buyers", displayStatus: "draft" });
    expect((await invoices.listTaxInvoices(t.companyId, { status: "final" })).total).toBe(0);

    // A lines-only change still bumps the version; a stale version conflicts.
    const edited = await invoices.updateTaxInvoice(t.companyId, draft.id, 1, {
      lines: [{ ...line, description: "Pipe 25mm" }],
    });
    expect(edited.version).toBe(2);
    expect(edited.lines[0].description).toBe("Pipe 25mm");
    await expect(
      invoices.updateTaxInvoice(t.companyId, draft.id, 1, { soNo: "X" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const peek = await invoices.peekNextInvoiceNo(t.companyId, "2026-10-14");
    const final = await invoices.finaliseTaxInvoice(t.companyId, draft.id, 2);
    expect(final).toMatchObject({ status: "final", invoiceNo: peek.invoiceNo });
    expect(final.snapshot?.billTo.name).toBe("Bharat Buyers");
    const [rate] = await sql`select last_rate_paise from items where id = ${item.id}`;
    expect(Number(rate.last_rate_paise)).toBe(100_00);
    const itemAudit = await sql`select action from audit_log where record_id = ${item.id}`;
    expect(itemAudit.map((a) => a.action)).toEqual(["update"]);
    await expect(
      invoices.updateTaxInvoice(t.companyId, draft.id, final.version, { soNo: "X" }),
    ).rejects.toThrow(/Finalised invoices can't be edited/);
    // Dates stay editable; moving into another FY keeps the number (and its FY) and the totals.
    const redated = await invoices.updateTaxInvoice(t.companyId, draft.id, final.version, {
      invoiceAt: "2027-04-02T06:00:00.000Z",
      soDate: "2027-04-01",
    });
    expect(redated).toMatchObject({
      invoiceNo: final.invoiceNo,
      invoiceAt: "2027-04-02T06:00:00.000Z",
      soDate: "2027-04-01",
      numberFy: final.numberFy,
    });
    expect(redated.totals).toEqual(final.totals);
    expect((await invoices.peekNextInvoiceNo(t.companyId, "2026-10-14")).counter).toBe(peek.counter + 1);

    const cancelled = await invoices.cancelTaxInvoice(t.companyId, draft.id, "Wrong buyer");
    expect(cancelled.cancelReason).toBe("Wrong buyer");
    expect((await invoices.listTaxInvoices(t.companyId, { status: "cancelled" })).total).toBe(1);

    // Imported: the seller's own number, unique per seller and FY.
    const imported = await invoices.createTaxInvoice(t.companyId, {
      invoiceAt,
      sellerPartyId: seller,
      invoiceNo: "SQ1",
      billToId: buyer,
      lines: [line],
    });
    expect(imported.invoiceNo).toBe("SQ1");
    await expect(
      invoices.createTaxInvoice(t.companyId, {
        invoiceAt,
        sellerPartyId: seller,
        invoiceNo: "SQ1",
        billToId: buyer,
        lines: [line],
      }),
    ).rejects.toThrow(/SQ1 is already used/);
    await expect(
      invoices.createTaxInvoice(t.companyId, { invoiceAt, billToId: crypto.randomUUID(), lines: [line] }),
    ).rejects.toThrow(/Bill-to party not found/);

    // The LR form's "from invoice" link: LRs that carry it.
    const lr = await lrs.createLr(t.companyId, {
      lrInvoices: [{ invoiceNo: "SQ1", taxInvoiceId: imported.id }],
    });
    expect((await invoices.listLrsForInvoice(t.companyId, imported.id)).map((l) => l.id)).toEqual([lr.id]);
    const row = (await invoices.listTaxInvoices(t.companyId, { search: "sq1" })).rows[0];
    expect(row.linkedLrs).toEqual([{ id: lr.id, lrNo: lr.lrNo }]);
    // The LR is found by its invoice no. (lines are inserted after the LR row).
    expect((await lrs.listLrs(t.companyId, { search: "sq1" })).total).toBe(1);
  });
});

describe("freight bills and payments on the database", () => {
  it("bill → finalise → payments drive the LR status and the dashboard's money", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const a = await fx.party(t.companyId, "Alpha Traders");
    const p = await fx.party(t.companyId, "Paying Party");
    const book = () =>
      lrs.createLr(
        t.companyId,
        {
          lrDate: "2026-10-14",
          fromPlace: "Patna",
          toPlace: "Gaya",
          consignorId: a,
          consigneeId: p,
          paymentMode: "tbb",
          items: [{ description: "Cement", packages: 10 }],
        },
        { book: true },
      );
    const lr1 = await book();
    const lr2 = await book();
    expect((await bills.listUnbilledLrs(t.companyId, p)).map((l) => l.id).sort()).toEqual(
      [lr1.id, lr2.id].sort(),
    );

    const draft = await bills.createFreightBill(t.companyId, {
      billDate: "2026-10-27",
      partyId: p,
      gstMode: "reverse_charge",
      lines: [{ lrId: lr1.id, freightPaise: 5000_00 }],
    });
    expect(draft).toMatchObject({ status: "draft", billNo: null, partyName: "Paying Party", lrNos: [lr1.lrNo] });
    expect(draft.totals.amountPaise).toBe(5000_00);
    await expect(
      bills.createFreightBill(t.companyId, {
        billDate: "2026-10-27",
        partyId: p,
        gstMode: "reverse_charge",
        lines: [{ lrId: lr1.id, freightPaise: 1 }],
      }),
    ).rejects.toThrow(/already on bill \(draft\)/);

    const two = await bills.updateFreightBill(t.companyId, draft.id, 1, {
      lines: [
        { lrId: lr1.id, freightPaise: 5000_00 },
        { lrId: lr2.id, freightPaise: 3000_00 },
      ],
    });
    expect(two).toMatchObject({ version: 2, lrNos: [lr1.lrNo, lr2.lrNo] });
    expect(two.totals.amountPaise).toBe(8000_00);
    expect((await bills.listFreightBills(t.companyId, { search: lr2.lrNo })).total).toBe(1);

    const final = await bills.finaliseFreightBill(t.companyId, draft.id, 2);
    expect(final.status).toBe("final");
    expect(final.billNo).toMatch(/001$/);
    expect(final.duePaise).toBe(8000_00);
    expect((await lrs.getLrById(t.companyId, lr1.id))!.status).toBe("Billed");
    await expect(
      bills.updateFreightBill(t.companyId, draft.id, final.version, { gstMode: "forward_charge" }),
    ).rejects.toThrow(/Finalised bills can't be edited/);
    // The date can still move, even into another FY; the number keeps its FY and amounts stay.
    const moved = await bills.updateFreightBill(t.companyId, draft.id, final.version, {
      billDate: "2027-04-02",
    });
    expect(moved).toMatchObject({
      billNo: final.billNo,
      billDate: "2027-04-02",
      numberFy: final.numberFy,
      version: final.version + 1,
    });
    expect(moved.totals).toEqual(final.totals);
    expect((await lrs.getLrById(t.companyId, lr1.id))!.billedAt).toBe("2027-04-02");
    const [billAudit] = await sql`select changes from audit_log
      where record_id = ${draft.id} order by created_at desc limit 1`;
    expect(billAudit.changes).toContainEqual({ field: "billDate", old: "2026-10-27", new: "2027-04-02" });

    const pay = (amountPaise: number, reference: string) => ({
      partyId: p,
      allocations: [{ freightBillId: draft.id, amountPaise }],
      amountPaise,
      mode: "neft_upi" as const,
      receivedOn: "2026-10-28",
      reference,
    });
    await expect(bills.createPayment(t.companyId, pay(9000_00, "TOO-MUCH"))).rejects.toThrow(
      /More than the ₹8,000.00 due/,
    );
    const first = await bills.createPayment(t.companyId, pay(3000_00, "UTR-1"));
    expect((await bills.getFreightBillById(t.companyId, draft.id))!).toMatchObject({
      receivedPaise: 3000_00,
      duePaise: 5000_00,
    });
    const second = await bills.createPayment(t.companyId, pay(5000_00, "UTR-2"));
    expect((await lrs.getLrById(t.companyId, lr2.id))!.status).toBe("Paid");
    expect((await dashboard.getDashboard(t.companyId)).freight.toCollectPaise).toBe(0);

    await expect(bills.cancelFreightBill(t.companyId, draft.id)).rejects.toThrow(
      /Payments are recorded against this bill/,
    );
    await bills.cancelPayment(t.companyId, second.id);
    expect((await lrs.getLrById(t.companyId, lr2.id))!.status).toBe("Billed");
    expect((await dashboard.getDashboard(t.companyId)).freight.toCollectPaise).toBe(5000_00);

    const edited = await bills.updatePayment(t.companyId, first.id, 1, pay(8000_00, "UTR-1"));
    expect(edited).toMatchObject({ version: 2, allocations: [{ freightBillId: draft.id, amountPaise: 8000_00 }] });
    expect((await lrs.getLrById(t.companyId, lr1.id))!.status).toBe("Paid");
    expect((await bills.listPayments(t.companyId, { search: "utr-1" })).total).toBe(1);
    expect((await bills.listPayments(t.companyId, {})).total).toBe(1); // the cancelled one is gone

    // Allocations gone → the bill can be cancelled and its LRs are free again.
    await bills.cancelPayment(t.companyId, first.id);
    const gone = await bills.cancelFreightBill(t.companyId, draft.id);
    expect(gone.cancelledAt).toBeDefined();
    expect((await lrs.getLrById(t.companyId, lr1.id))!.status).toBe("Booked");
    expect((await bills.listUnbilledLrs(t.companyId, p)).length).toBe(2);
  });
});

describe("Smart import on the database", () => {
  const xlsx = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]);

  it("Excel: upload → map → save mapping → import valid rows (system audit, LR series moved)", async () => {
    const t = await fx.team();
    signIn(t.owner, t.companyId);
    const b = await imports.createImportBatch(t.companyId, {
      source: "excel",
      fileName: "RSL_Booking_Report.xlsx",
      bytes: xlsx,
    });
    expect(b).toMatchObject({ status: "read", detectedAs: "booking_report", createdBy: t.owner });
    expect(b.fileUrl).toMatch(/^\/uploads\/[0-9a-f-]{36}\?b=imports&n=RSL_Booking_Report\.xlsx$/);
    const [row] = await imports.listImportFiles(t.companyId);
    expect(row.chip.label).toBe("2 columns to confirm");

    await imports.setColumnMapping(t.companyId, b.id, "Wt", "actual_weight");
    await imports.saveImportMapping(t.companyId, b.id, "RSL Booking Report");
    expect((await imports.listImportMappings(t.companyId)).map((m) => m.name)).toEqual([
      "RSL Booking Report",
    ]);
    const second = await imports.createImportBatch(t.companyId, {
      source: "excel",
      fileName: "Next.xlsx",
      bytes: xlsx,
    });
    expect(second.mappingName).toBe("RSL Booking Report");
    await imports.removeImportBatch(t.companyId, second.id);

    const review = (await imports.getExcelReview(t.companyId, b.id))!;
    expect(review.importable).toBeGreaterThan(0);
    const summary = await imports.commitExcelBatch(t.companyId, b.id);
    expect(summary.lrsCreated).toBe(review.importable);
    expect(summary.partiesCreated).toBeGreaterThan(0);

    const created = await sql`select id, lr_no from lrs where company_id = ${t.companyId}
                                and import_batch_id = ${b.id}`;
    expect(created).toHaveLength(summary.lrsCreated);
    const audit = await sql`select actor, user_id, batch_id from audit_log
                             where record_id = ${created[0].id}`;
    expect(audit).toEqual([{ actor: "system", user_id: null, batch_id: b.id }]);
    const max = Math.max(...created.map((r) => Number(r.lr_no)));
    expect(Number(await lrs.peekNextLrNo(t.companyId, "2026-10-29"))).toBe(max + 1);

    const history = await imports.listImportHistory(t.companyId);
    expect(history.rows[0]).toMatchObject({ id: b.id, status: "imported" });
    expect(history.rows[0].created).toBe(summary.lrsCreated + summary.partiesCreated + summary.trucksCreated);
    await expect(imports.commitExcelBatch(t.companyId, b.id)).rejects.toThrow(/already been imported/);
  });

  it("invoice photo: prefill → save creates pending records + draft, linked to the file", async () => {
    const t = await fx.team();
    signIn(t.staff, t.companyId);
    const b = await imports.createImportBatch(t.companyId, {
      source: "document",
      fileName: "new_invoice.png",
      bytes: png,
    });
    expect(b.detectedAs).toBe("tax_invoice");
    const view = (await imports.getInvoiceImport(t.companyId, b.id))!;
    expect(view.existing).toBeNull();
    const built = formToInvoiceInput(view.prefill.initial, {
      imported: true,
      sellerPartyId: view.prefill.seller.partyId,
    });
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const invoice = await imports.saveImportedInvoice(t.companyId, {
      batchId: b.id,
      input: built.input,
      pending: view.prefill.pending,
    });
    expect(invoice).toMatchObject({ status: "draft", importBatchId: b.id, sourceFileUrl: b.fileUrl });
    const audit = await sql`select actor, user_id, batch_id from audit_log
                             where record_id = ${invoice.id}`;
    expect(audit).toEqual([{ actor: "user", user_id: t.staff, batch_id: b.id }]);
    expect(await imports.getInvoiceImport(t.companyId, b.id)).toBeNull();
    expect((await imports.getImportResult(t.companyId, b.id))!.invoices).toBe(1);

    // The same file again: the invoice now exists as a draft — saving would update it.
    const again = await imports.createImportBatch(t.companyId, {
      source: "document",
      fileName: "new_invoice.png",
      bytes: png,
    });
    const review = (await imports.getDocumentReview(t.companyId, again.id))!;
    expect(review.reasons.join()).toMatch(/already in the system as a draft/);
    const view2 = (await imports.getInvoiceImport(t.companyId, again.id))!;
    expect(view2.existing).toMatchObject({ id: invoice.id, status: "draft" });
    expect(view2.prefill.pending).toEqual({ parties: {}, trucks: {} });
    const built2 = formToInvoiceInput(view2.prefill.initial, {
      imported: true,
      sellerPartyId: view2.prefill.seller.partyId,
    });
    if (!built2.ok) throw new Error(JSON.stringify(built2.errors));
    await expect(
      imports.saveImportedInvoice(t.companyId, {
        batchId: again.id,
        input: built2.input,
        pending: view2.prefill.pending,
        update: { id: invoice.id, expectedVersion: 99 },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const updated = await imports.saveImportedInvoice(t.companyId, {
      batchId: again.id,
      input: built2.input,
      pending: view2.prefill.pending,
      update: { id: invoice.id, expectedVersion: view2.existing!.version },
    });
    expect(updated).toMatchObject({ id: invoice.id, version: 2, importBatchId: again.id });
  });
});

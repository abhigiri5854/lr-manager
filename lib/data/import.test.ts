import { beforeEach, describe, expect, it, vi } from "vitest";
import { formToInvoiceInput } from "@/lib/invoice-form";
import type { Role } from "@/lib/types";
import { db, resetStore, SAMPLE_IDS } from "./_store";
import { ForbiddenError, ValidationError } from "./errors";
import {
  applyImportMapping,
  commitExcelBatch,
  createImportBatch,
  errorReportRows,
  getDocumentReview,
  getExcelReview,
  getInvoiceImport,
  listImportFiles,
  listImportHistory,
  listImportMappings,
  removeImportBatch,
  saveImportedInvoice,
  saveImportMapping,
  setColumnMapping,
  setRowAction,
} from "./import";
import * as lrs from "./lrs";
import { getCompany } from "./companies";

const acmId = () => db.companies.find((c) => c.label === "ACM Logistics")!.id;
const xlsx = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]);

function actAs(role: Role) {
  db.memberships.find((m) => m.companyId === acmId() && m.userId === SAMPLE_IDS.ownerId)!.role =
    role;
}

const upload = (name = "RSL_Booking_Report.xlsx") =>
  createImportBatch(acmId(), { source: "excel", fileName: name, bytes: xlsx });
const uploadDoc = (name: string) =>
  createImportBatch(acmId(), { source: "document", fileName: name, bytes: png });
const lrNos = () => db.lrs.map((l) => l.lrNo).sort();

beforeEach(() => resetStore());

describe("uploading", () => {
  it("makes a batch per file, reads it, and lists it with a status chip", async () => {
    const b = await upload();
    expect(b).toMatchObject({
      source: "excel",
      format: "xlsx",
      status: "read",
      detectedAs: "booking_report",
      createdBy: SAMPLE_IDS.ownerId,
      sizeBytes: xlsx.byteLength,
    });
    expect(b.fileUrl).toMatch(/^\/uploads\/[0-9a-f-]{36}\?n=RSL_Booking_Report\.xlsx$/);
    expect(Object.keys(b.mapping)).toHaveLength(15);
    const [row] = await listImportFiles(acmId());
    expect(row).toMatchObject({
      fileName: "RSL_Booking_Report.xlsx",
      detected: "Excel booking report",
      format: "Excel (.xlsx)",
      chip: { tone: "amber", label: "2 columns to confirm" },
      action: { kind: "review", href: `/import?batch=${b.id}` },
    });
    expect(row.found).toBe("Sheet1 · header on row 3 · 15 columns · 10 rows");
  });

  it("refuses the wrong type, fake files, empty files and files over 10 MB", async () => {
    const bad = (input: Parameters<typeof createImportBatch>[1]) =>
      createImportBatch(acmId(), input).catch((e) => e);
    expect(await bad({ source: "excel", fileName: "a.pdf", bytes: png })).toBeInstanceOf(
      ValidationError,
    );
    const fake = await bad({ source: "document", fileName: "a.pdf", bytes: png });
    expect(fake.message).toMatch(/doesn't look like a real PDF/);
    const empty = await bad({ source: "document", fileName: "a.png", bytes: new Uint8Array() });
    expect(empty.message).toMatch(/empty/);
    const huge = new Uint8Array(10 * 1024 * 1024 + 1);
    huge.set([0x25, 0x50, 0x44, 0x46]);
    const big = await bad({ source: "document", fileName: "big.pdf", bytes: huge });
    expect(big.message).toMatch(/limit is 10 MB/);
    expect(db.importBatches).toHaveLength(0);
  });

  it("Accountants can import documents but not Excel booking reports", async () => {
    actAs("accountant");
    await expect(upload()).rejects.toThrow("Your role (Accountant) can't create or edit LRs.");
    await expect(uploadDoc("invoice_SQ2604002116.png")).resolves.toMatchObject({ status: "read" });
  });

  it("Booking staff can do both; a Driver can do neither", async () => {
    actAs("booking_staff");
    await expect(upload()).resolves.toMatchObject({ status: "read" });
    actAs("driver");
    await expect(upload()).rejects.toThrow(ForbiddenError);
    await expect(uploadDoc("a.png")).rejects.toThrow(ForbiddenError);
  });

  it("applies a saved mapping that covers the sheet's columns", async () => {
    const first = await upload();
    await setColumnMapping(acmId(), first.id, "Wt", "actual_weight");
    await saveImportMapping(acmId(), first.id, "RSL Booking Report");
    const second = await upload("Next_Week.xlsx");
    expect(second.mappingName).toBe("RSL Booking Report");
    expect(second.mapping.Wt).toBe("actual_weight");
    expect(second.confirmedColumns).toHaveLength(15);
    expect((await listImportFiles(acmId())).find((f) => f.id === second.id)!.chip.label).toBe(
      "3 rows with errors",
    );
  });
});

describe("reviewing an Excel file", () => {
  it("counts valid / warning / error rows and shows what will be saved", async () => {
    const b = await upload();
    const review = (await getExcelReview(acmId(), b.id))!;
    expect(review.counts).toEqual({ valid: 5, warning: 2, error: 3 });
    // 5 valid + the unusual-vehicle row; LR 19019 (exists) and the 3 errors are skipped
    expect(review.importable).toBe(6);
    expect(review.savedInto).toMatchObject({
      lrNew: 6,
      lrUpdate: 0,
      lrSkipped: 4,
      partiesNew: 1, // Shree Ganesh Traders
      trucksNew: 1, // BR01GA4455
      invoicesLinked: 1, // SQ2604002116
    });
    expect(review.columns.find((c) => c.header === "Wt")).toMatchObject({ match: "confirm" });
    expect(review.columns.find((c) => c.header === "LR No")).toMatchObject({
      match: "sure",
      fieldLabel: "LR → LR number",
    });
    const dup = review.rows.find((r) => r.rowNo === 8)!;
    expect(dup).toMatchObject({ status: "warning", action: "skip", allowed: ["skip", "update"] });
    expect(dup.reasons).toEqual(["LR 19019 is already in the system"]);
  });

  it("answering a Confirm column and picking row actions persists", async () => {
    const b = await upload();
    await setColumnMapping(acmId(), b.id, "Wt", "actual_weight");
    await setColumnMapping(acmId(), b.id, "Remarks 2", "remarks");
    await setRowAction(acmId(), b.id, 4, "skip");
    await setRowAction(acmId(), b.id, 8, "update");
    const review = (await getExcelReview(acmId(), b.id))!;
    expect(review.columns.filter((c) => c.match === "confirm")).toHaveLength(0);
    expect(review.rows.find((r) => r.rowNo === 4)!.action).toBe("skip");
    expect(review.rows.find((r) => r.rowNo === 8)!.action).toBe("update");
    expect(review.importable).toBe(6); // row 4 out, the updated duplicate in
    expect(db.importBatches[0].status).toBe("reviewed");
    await expect(setColumnMapping(acmId(), b.id, "Nope", "lr_no")).rejects.toThrow(
      /isn't in this file/,
    );
    await expect(setColumnMapping(acmId(), b.id, "Wt", "bogus")).rejects.toThrow(/Choose where/);
  });

  it("saves and re-applies a named mapping", async () => {
    const b = await upload();
    await setColumnMapping(acmId(), b.id, "Wt", "actual_weight");
    await saveImportMapping(acmId(), b.id, "  RSL Booking Report ");
    const [saved] = await listImportMappings(acmId());
    expect(saved).toMatchObject({ name: "RSL Booking Report" });
    expect(saved.columns.Wt).toBe("actual_weight");
    await setColumnMapping(acmId(), b.id, "Wt", "billing_weight");
    await applyImportMapping(acmId(), b.id, saved.id);
    expect((await getExcelReview(acmId(), b.id))!).toMatchObject({
      mappingName: "RSL Booking Report",
    });
    expect(db.importBatches[0].mapping.Wt).toBe("actual_weight");
    await expect(saveImportMapping(acmId(), b.id, "   ")).rejects.toThrow(ValidationError);
    // same name again replaces, never duplicates
    await saveImportMapping(acmId(), b.id, "rsl booking report");
    expect(await listImportMappings(acmId())).toHaveLength(1);
  });

  it("builds an error report for the rows with errors", async () => {
    const b = await upload();
    const report = (await errorReportRows(acmId(), b.id))!;
    expect(report.headers).toHaveLength(15);
    expect(report.rows.map((r) => r.rowNo)).toEqual([10, 11, 12]);
    expect(report.rows[0].reason).toBe("Consignor GSTIN has 14 characters (needs 15)");
    expect(report.rows[0].cells[0]).toBe("19026");
  });
});

describe("Import valid rows", () => {
  it("creates draft LRs with the sheet's numbers, parties and trucks, in one go", async () => {
    const b = await upload();
    const parties = db.parties.length;
    const trucks = db.trucks.length;
    const summary = await commitExcelBatch(acmId(), b.id);
    expect(summary).toEqual({
      lrsCreated: 6,
      lrsUpdated: 0,
      skipped: 4,
      partiesCreated: 1,
      trucksCreated: 1,
    });
    expect(lrNos()).toEqual(
      ["19019", "19020", "19021", "19022", "19023", "19024", "19025", "19027"].sort(),
    );
    const lr = db.lrs.find((l) => l.lrNo === "19022")!;
    expect(lr).toMatchObject({
      bookedAt: null, // drafts: the sheet has no payment mode, so they can't be booked
      importBatchId: b.id,
      ratePaise: 1000,
      charges: { freight: 1200000 },
      lrDate: "2026-10-16",
    });
    expect(lr.lrInvoices[0]).toMatchObject({
      invoiceNo: "SQ2604002116",
      taxInvoiceId: db.taxInvoices[0].id,
    });
    expect(lr.items[0]).toMatchObject({ packages: 15, chargedWeight: "1200.000" });
    // the unusual vehicle number row was imported without a truck
    expect(db.lrs.find((l) => l.lrNo === "19025")!.truckId).toBeNull();
    expect(db.parties.length).toBe(parties + 1);
    expect(db.parties.find((p) => p.name === "Shree Ganesh Traders")).toMatchObject({
      source: "excel_import",
      gstin: "20AABCS1234F1Z5",
    });
    expect(db.trucks.length).toBe(trucks + 1);
    expect(db.trucks.find((t) => t.number === "BR01GA4455")!.source).toBe("excel_import");
    // later LRs carry on after the highest imported number
    expect((await getCompany(acmId()))!.nextLrNo).toBe(19028);
    expect(db.numberSeries.find((s) => s.series === "lr")!.nextValue).toBe(19028);
  });

  it("marks the file imported, links the records and writes 'system' audit rows with the batch id", async () => {
    const b = await upload();
    const before = db.audit.length;
    await commitExcelBatch(acmId(), b.id);
    const batch = db.importBatches[0];
    expect(batch).toMatchObject({ status: "imported", counts: { valid: 5, warning: 2, error: 3 } });
    expect(batch.importedAt).not.toBeNull();
    expect(batch.createdRecords.map((r) => r.table).sort()).toEqual([
      "lrs",
      "lrs",
      "lrs",
      "lrs",
      "lrs",
      "lrs",
      "parties",
      "trucks",
    ]);
    const mine = db.audit
      .slice(before)
      .filter((a) => batch.createdRecords.some((r) => r.id === a.recordId));
    expect(mine).toHaveLength(8);
    for (const a of mine)
      expect(a).toMatchObject({ userId: "system", batchId: b.id, action: "create" });
    // the batch itself is updated as "system" too
    expect(db.audit.slice(before).every((a) => a.userId === "system" && a.batchId === b.id)).toBe(
      true,
    );
    // after: not in the files list, in the history
    expect(await listImportFiles(acmId())).toHaveLength(0);
    const history = await listImportHistory(acmId());
    expect(history.rows).toEqual([
      expect.objectContaining({
        fileName: "RSL_Booking_Report.xlsx",
        by: "Owner",
        status: "imported",
        created: 8,
      }),
    ]);
    await expect(commitExcelBatch(acmId(), b.id)).rejects.toThrow(/already been imported/);
    await expect(removeImportBatch(acmId(), b.id)).rejects.toThrow(/stays in the history/);
  });

  it("honours the user's Skip choices and refuses an empty import", async () => {
    const b = await upload();
    for (const rowNo of [4, 5, 6, 7, 9, 13]) await setRowAction(acmId(), b.id, rowNo, "skip");
    await expect(commitExcelBatch(acmId(), b.id)).rejects.toThrow(/Nothing to import/);
    await setRowAction(acmId(), b.id, 4, "import");
    expect(await commitExcelBatch(acmId(), b.id)).toMatchObject({ lrsCreated: 1 });
    expect(lrNos()).toContain("19021");
    expect(lrNos()).not.toContain("19022");
  });

  it("Update fills blanks only and never overwrites", async () => {
    const b = await upload();
    // Make the duplicate row point at the draft LR 19020, which has a truck but no rate or freight.
    const result = db.importBatches[0].result as {
      rows: { rowNo: number; cells: Record<string, string> }[];
    };
    result.rows.find((r) => r.rowNo === 8)!.cells["LR No"] = "19020";
    result.rows.find((r) => r.rowNo === 8)!.cells["Vehicle No"] = "BR01GN8331";
    await setRowAction(acmId(), b.id, 8, "update");
    const lr20 = db.lrs.find((l) => l.lrNo === "19020")!;
    const truckBefore = lr20.truckId;
    expect(lr20.ratePaise).toBeNull();
    const summary = await commitExcelBatch(acmId(), b.id);
    expect(summary.lrsUpdated).toBe(1);
    const after = db.lrs.find((l) => l.lrNo === "19020")!;
    expect(after.truckId).toBe(truckBefore); // already had a truck: untouched
    expect(after.ratePaise).toBe(1250);
    expect(after.charges.freight).toBe(705000);
    expect(after.items[0].chargedWeight).toBe("564.000");
    expect(after.consignorId).toBe(lr20.consignorId); // parties never touched
  });

  it("rolls everything back when a row fails, and marks the file failed", async () => {
    const b = await upload();
    const original = lrs.createImportedLr;
    let calls = 0;
    const spy = vi.spyOn(lrs, "createImportedLr").mockImplementation(async (...args) => {
      if (++calls === 3)
        throw new ValidationError([{ path: "lrNo", message: "LR 19023 already exists" }]);
      return original(...args);
    });
    const snapshot = {
      lrs: db.lrs.length,
      parties: db.parties.length,
      trucks: db.trucks.length,
      audit: db.audit.length,
      next: db.numberSeries.find((s) => s.series === "lr")!.nextValue,
    };
    await expect(commitExcelBatch(acmId(), b.id)).rejects.toThrow(
      "Excel row 6: LR 19023 already exists",
    );
    spy.mockRestore();
    expect(db.lrs).toHaveLength(snapshot.lrs);
    expect(db.parties).toHaveLength(snapshot.parties);
    expect(db.trucks).toHaveLength(snapshot.trucks);
    expect(db.numberSeries.find((s) => s.series === "lr")!.nextValue).toBe(snapshot.next);
    // only the file's own "failed" update is new
    expect(db.audit.length).toBe(snapshot.audit + 1);
    expect(db.importBatches[0]).toMatchObject({
      status: "failed",
      error: "Excel row 6: LR 19023 already exists",
      createdRecords: [],
    });
    // ...and it can be retried
    expect(await commitExcelBatch(acmId(), b.id)).toMatchObject({ lrsCreated: 6 });
  });

  it("is refused for an Accountant", async () => {
    const b = await upload();
    actAs("accountant");
    await expect(commitExcelBatch(acmId(), b.id)).rejects.toThrow(ForbiddenError);
    expect(lrNos()).toEqual(["19019", "19020"]);
  });
});

describe("removing files", () => {
  it("soft-removes an unfinished file", async () => {
    const b = await upload();
    await removeImportBatch(acmId(), b.id);
    expect(await listImportFiles(acmId())).toHaveLength(0);
    expect(db.importBatches[0].cancelledAt).toBeDefined(); // kept, never deleted
    expect(await getExcelReview(acmId(), b.id)).toBeNull();
  });
});

describe("invoice and document files", () => {
  it("lists a read invoice as Ready, opening in the Tax invoice form", async () => {
    const b = await uploadDoc("invoice_SQ2604002116.png");
    expect(b).toMatchObject({ detectedAs: "tax_invoice", status: "read" });
    const [row] = await listImportFiles(acmId());
    expect(row).toMatchObject({
      detected: "Tax invoice · photo",
      chip: { tone: "green", label: "Ready" },
      action: { kind: "open_invoice", href: `/invoices/new?import=${b.id}` },
    });
    expect(row.found).toBe("Seller, buyer, 3 items, taxable ₹1,56,697.10, truck BR06GB7374");
  });

  it("an LR photo for an LR that exists is 'Already exists'", async () => {
    await uploadDoc("LR_19019.png");
    const [row] = await listImportFiles(acmId());
    expect(row).toMatchObject({
      detected: "Consignment note · photo",
      chip: { label: "Already exists" },
    });
    const review = (await getDocumentReview(acmId(), row.id))!;
    expect(review).toMatchObject({ status: "warning", reasons: ["Same LR no. already in system"] });
  });

  it("prefills SQ2604002116 from saved records and finds the existing draft", async () => {
    const b = await uploadDoc("invoice_SQ2604002116.png");
    const view = (await getInvoiceImport(acmId(), b.id))!;
    expect(view.existing).toMatchObject({ status: "draft", invoiceNo: "SQ2604002116" });
    expect(view.prefill.pending).toEqual({ parties: {}, trucks: {} });
    expect(view.prefill.initial).toMatchObject({
      invoiceNo: "SQ2604002116",
      customerRef: "1789-80520-",
      shipSame: true,
    });
    expect(view.prefill.initial.billTo!.id).toBe(
      db.parties.find((p) => p.name === "1789 India Trading")!.id,
    );
    expect(view.prefill.initial.truck!.number).toBe("BR06GB7374");
    expect(view.prefill.initial.lines.map((l) => l.itemId)).toHaveLength(3);
    expect(view.prefill.initial.lines.every((l) => l.itemId)).toBe(true);
    expect(view.prefill.flags).toEqual({
      customerRefDate: "low-confidence",
      soNo: "low-confidence",
    });
    expect(view.batch.fileUrl).toMatch(/^\/uploads\//);
  });

  it("a new buyer, truck and item come back as pending and orange — nothing is created", async () => {
    const b = await uploadDoc("new_invoice.png");
    const parties = db.parties.length;
    const view = (await getInvoiceImport(acmId(), b.id))!;
    expect(view.existing).toBeNull();
    expect(Object.keys(view.prefill.pending.parties)).toEqual(["new:billTo"]);
    expect(view.prefill.pending.trucks).toEqual({ "new:truck": { number: "BR01GA4455" } });
    expect(view.prefill.flags).toMatchObject({
      billTo: "new-record",
      truck: "new-record",
      "lines.0.description": "new-record",
      "lines.0.hsn": "low-confidence",
    });
    expect(view.prefill.initial.billTo!.id).toBe("new:billTo");
    expect(db.parties).toHaveLength(parties);
    expect(db.trucks.some((t) => t.number === "BR01GA4455")).toBe(false);
  });

  it("saving creates the pending records and the draft invoice, linked to the file", async () => {
    const b = await uploadDoc("new_invoice.png");
    const view = (await getInvoiceImport(acmId(), b.id))!;
    const built = formToInvoiceInput(view.prefill.initial, {
      imported: true,
      sellerPartyId: view.prefill.seller.partyId,
    });
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const before = db.audit.length;
    const invoice = await saveImportedInvoice(acmId(), {
      batchId: b.id,
      input: built.input,
      pending: view.prefill.pending,
    });
    expect(invoice).toMatchObject({
      invoiceNo: "SQ2604002117",
      status: "draft",
      importBatchId: b.id,
      sourceFileUrl: db.importBatches[0].fileUrl,
    });
    const buyer = db.parties.find((p) => p.name === "Shree Ganesh Traders")!;
    expect(buyer).toMatchObject({ source: "invoice_scan", stateCode: "20" });
    expect(invoice.billToId).toBe(buyer.id);
    const truck = db.trucks.find((t) => t.number === "BR01GA4455")!;
    expect(truck.source).toBe("invoice_scan");
    expect(invoice.truckId).toBe(truck.id);
    expect(db.importBatches[0]).toMatchObject({ status: "imported" });
    expect(db.importBatches[0].createdRecords.map((r) => r.table).sort()).toEqual([
      "parties",
      "tax_invoices",
      "trucks",
    ]);
    // done by the signed-in user (they pressed Save), tagged with the file
    const audits = db.audit.slice(before);
    expect(audits.every((a) => a.userId === SAMPLE_IDS.ownerId && a.batchId === b.id)).toBe(true);
    // the file now opens the saved invoice and can't be saved twice
    expect(await getInvoiceImport(acmId(), b.id)).toBeNull();
    const history = await listImportHistory(acmId());
    expect(history.rows[0]).toMatchObject({ fileName: "new_invoice.png", status: "imported" });
  });

  it("saving SQ2604002116 updates the existing draft instead of making a second one", async () => {
    const b = await uploadDoc("invoice_SQ2604002116.png");
    const view = (await getInvoiceImport(acmId(), b.id))!;
    const built = formToInvoiceInput(view.prefill.initial, {
      imported: true,
      sellerPartyId: view.prefill.seller.partyId,
    });
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const invoice = await saveImportedInvoice(acmId(), {
      batchId: b.id,
      input: built.input,
      pending: view.prefill.pending,
      update: { id: view.existing!.id, expectedVersion: view.existing!.version },
    });
    expect(db.taxInvoices).toHaveLength(1);
    expect(invoice).toMatchObject({ id: view.existing!.id, version: 2, importBatchId: b.id });
    expect(invoice.sourceFileUrl).toBe(db.importBatches[0].fileUrl);
    // a stale version is refused and nothing else is created
    const again = await uploadDoc("invoice_SQ2604002116.png");
    await expect(
      saveImportedInvoice(acmId(), {
        batchId: again.id,
        input: built.input,
        pending: view.prefill.pending,
        update: { id: view.existing!.id, expectedVersion: 1 },
      }),
    ).rejects.toThrow(/changed by someone else/);
  });

  it("Booking staff and Accountants can save an imported invoice", async () => {
    for (const role of ["booking_staff", "accountant"] as const) {
      resetStore();
      actAs(role);
      const b = await uploadDoc("new_invoice.png");
      const view = (await getInvoiceImport(acmId(), b.id))!;
      const built = formToInvoiceInput(view.prefill.initial, {
        imported: true,
        sellerPartyId: view.prefill.seller.partyId,
      });
      if (!built.ok) throw new Error("form");
      await expect(
        saveImportedInvoice(acmId(), {
          batchId: b.id,
          input: built.input,
          pending: view.prefill.pending,
        }),
      ).resolves.toMatchObject({ status: "draft" });
    }
  });
});

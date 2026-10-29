// Tax invoices on the database. Same behaviour as the mock half of ../invoices.ts.
// Fast patterns (CLAUDE.md): an edit reads what it needs in one pipelined round trip (row lock,
// company, parties, reference checks), then sends the row + its replaced lines (+ the duplicate
// number check) together; the audit row leaves with the commit.
import { financialYear } from "@/lib/fy";
import { invoiceStatus } from "@/lib/invoice-status";
import { companySnapshot, partySnapshot } from "@/lib/snapshots";
import type { LrView, Page, TaxInvoice, TaxInvoiceLine, TaxInvoiceRow } from "@/lib/types";
import { formatInvoiceNo, type taxInvoiceFields } from "@/lib/validators/invoice";
import { fail, newId, now } from "../_store";
import { ConflictError, NotFoundError } from "../errors";
import {
  applyFinalInvoiceDates,
  applyInvoicePatch,
  assertImportedHasNo,
  INVOICE_NO_TOO_LONG,
  invoiceDay,
  placeOfSupply,
  priceInvoice,
  type InvoiceCtx,
  type InvoiceHeader,
  type ParsedInvoicePatch,
} from "../invoice-calc";
import type { TaxInvoiceListParams } from "../invoices";
import { contains, paging, withUser, withUserRead, type Tx } from "./conn";
import { isUuid, LR_SELECT } from "./lrs";
import { audit, toCompany, toLrView, toParty, toTaxInvoice, type Row } from "./rows";
import { importPathFromUrl } from "./storage";
import {
  assertNoProblems,
  cancelRow,
  checkedWrite,
  refCheck,
  runChecks,
  uuidsIn,
  type Check,
  type Fragment,
} from "./write";

type ParsedInput = ReturnType<typeof taxInvoiceFields.parse>;

// ---------- reading ----------
/** The invoice's lines as json, keyed like TaxInvoiceLine (alias `a` = a tax_invoices row). */
const linesJson = (tx: Tx, a: Fragment) => tx`coalesce((select json_agg(json_build_object(
    'id', l.id, 'lineNo', l.line_no, 'itemId', l.item_id, 'itemCode', l.item_code,
    'description', l.description, 'hsn', l.hsn, 'uom', l.uom, 'qty', l.qty::text,
    'ratePaise', l.rate_paise, 'discountPaise', l.discount_paise, 'taxablePaise', l.taxable_paise,
    'gstRateBp', l.gst_rate_bp, 'sgstPaise', l.sgst_paise, 'cgstPaise', l.cgst_paise,
    'igstPaise', l.igst_paise) order by l.line_no)
  from tax_invoice_lines l where l.company_id = ${a}.company_id and l.tax_invoice_id = ${a}.id), '[]')`;

const INVOICE_SELECT = (tx: Tx) =>
  tx`select t.*, ${linesJson(tx, tx`t`)} as lines from tax_invoices t`;

/** List row extras on alias `t`: bill-to name + GSTIN and the live LRs that carry it. */
const ROW_SELECT = (tx: Tx) => tx`
  select t.*, ${linesJson(tx, tx`t`)} as lines, bt.name as bill_to_name, bt.gstin as bill_to_gstin,
         coalesce((select json_agg(json_build_object('id', l.id, 'lrNo', l.lr_no)
                                   order by l.created_at, l.id)
                     from lrs l
                    where l.company_id = t.company_id and l.cancelled_at is null
                      and l.id in (select v.lr_id from lr_invoices v
                                    where v.company_id = t.company_id
                                      and v.tax_invoice_id = t.id)), '[]') as linked_lrs
    from tax_invoices t
    left join parties bt on bt.company_id = t.company_id and bt.id = t.bill_to_id`;

function toRow(r: Row): TaxInvoiceRow {
  const inv = toTaxInvoice(r);
  const billTo = inv.snapshot?.billTo;
  return {
    ...inv,
    displayStatus: invoiceStatus(inv),
    billToName: billTo?.name ?? r.bill_to_name ?? "",
    billToGstin: billTo ? billTo.gstin : (r.bill_to_gstin ?? null),
    linkedLrs: r.linked_lrs,
  };
}

function listWhere(tx: Tx, companyId: string, p: TaxInvoiceListParams) {
  const q = contains(p.search);
  return tx`t.company_id = ${companyId}
    ${
      p.status === "cancelled"
        ? tx`and t.cancelled_at is not null`
        : p.status
          ? tx`and t.cancelled_at is null and t.status = ${p.status}`
          : tx``
    }
    ${
      p.partyId === undefined
        ? tx``
        : isUuid(p.partyId)
          ? tx`and ${p.partyId} in (t.seller_party_id, t.bill_to_id, t.ship_to_id)`
          : tx`and false`
    }
    ${p.from ? tx`and (t.invoice_at at time zone 'Asia/Kolkata')::date >= ${p.from}` : tx``}
    ${p.to ? tx`and (t.invoice_at at time zone 'Asia/Kolkata')::date <= ${p.to}` : tx``}
    ${
      q
        ? tx`and (t.search_text like ${q} or exists (
                select 1 from parties s where s.company_id = t.company_id
                   and s.id = t.seller_party_id and lower(s.name) like ${q}))`
        : tx``
    }`;
}

export async function listTaxInvoices(
  companyId: string,
  params: TaxInvoiceListParams,
): Promise<Page<TaxInvoiceRow>> {
  const { page, pageSize, offset } = paging(params);
  return withUserRead(async (tx) => {
    const [rows, [{ n }]] = await Promise.all([
      tx`${ROW_SELECT(tx)} where ${listWhere(tx, companyId, params)}
          order by t.invoice_at desc, t.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from tax_invoices t where ${listWhere(tx, companyId, params)}`,
    ]);
    return { rows: rows.map(toRow), total: n as number, page, pageSize };
  });
}

export async function getTaxInvoiceById(companyId: string, id: string): Promise<TaxInvoice | null> {
  if (!isUuid(id)) return null;
  return withUserRead(async (tx) => {
    const [r] = await tx`${INVOICE_SELECT(tx)} where t.company_id = ${companyId} and t.id = ${id}`;
    return r ? toTaxInvoice(r) : null;
  });
}

export async function listLrsForInvoice(companyId: string, invoiceId: string): Promise<LrView[]> {
  if (!isUuid(invoiceId)) return [];
  return withUserRead(async (tx) => {
    const rows = await tx`${LR_SELECT(tx)}
      where l.company_id = ${companyId} and l.cancelled_at is null
        and l.id in (select v.lr_id from lr_invoices v
                      where v.company_id = ${companyId} and v.tax_invoice_id = ${invoiceId})
      order by l.created_at, l.id`;
    return rows.map(toLrView);
  });
}

export async function peekInvoiceCounter(
  companyId: string,
  fy: string,
): Promise<{ prefix: string; counter: number }> {
  return withUserRead(async (tx) => {
    const [r] = await tx`select c.tax_invoice_prefix,
                                app.peek_number(c.id, 'tax_invoice', ${fy}) as n
                           from companies c where c.id = ${companyId}`;
    return { prefix: (r?.tax_invoice_prefix as string) ?? "", counter: (r?.n as number) ?? 1 };
  });
}

// ---------- writing ----------
/** The context the pricing rules need, from a companies row and the parties read with it. */
function ctxFrom(company: Row, parties: Row[]): InvoiceCtx {
  const byId = new Map(parties.map((p) => [p.id as string, p]));
  return {
    company: { gstin: company.gstin, invoiceRoundOff: company.invoice_round_off },
    party: (id) => {
      const p = id ? byId.get(id) : undefined;
      return p ? toParty(p) : undefined;
    },
  };
}

function refChecks(tx: Tx, companyId: string, v: ParsedInvoicePatch): Check[] {
  return [
    ...refCheck(tx, companyId, "parties", "sellerPartyId", "Seller", v.sellerPartyId),
    ...refCheck(tx, companyId, "parties", "billToId", "Bill-to party", v.billToId),
    ...refCheck(tx, companyId, "parties", "shipToId", "Ship-to party", v.shipToId),
    ...refCheck(tx, companyId, "trucks", "truckId", "Truck", v.truckId),
    ...(v.lines ?? []).flatMap((l, i) =>
      refCheck(tx, companyId, "items", `lines.${i}.itemId`, "Item", l.itemId),
    ),
  ];
}

/** Quantities as the column keeps them (numeric(14,3)), so a saved invoice equals a re-read one. */
const withDbQty = (lines: TaxInvoiceLine[]): TaxInvoiceLine[] =>
  lines.map((l) => ({ ...l, qty: Number(l.qty).toFixed(3) }));

function sourcePath(companyId: string, url: string | null): string | null {
  try {
    return importPathFromUrl(companyId, url);
  } catch {
    fail("sourceFileUrl", "Upload the invoice file again");
  }
}

/** tax_invoices columns from the record (not the number / seq, which finalise sets). */
function invoiceColumns(tx: Tx, inv: TaxInvoice): Row {
  return {
    invoice_no: inv.invoiceNo,
    invoice_fy: financialYear(invoiceDay(inv.invoiceAt)),
    invoice_at: inv.invoiceAt,
    seller_party_id: inv.sellerPartyId,
    bill_to_id: inv.billToId,
    ship_to_id: inv.shipToId,
    place_of_supply_state_code: inv.placeOfSupplyStateCode,
    customer_ref: inv.customerRef,
    customer_ref_date: inv.customerRefDate,
    so_no: inv.soNo,
    so_date: inv.soDate,
    do_no: inv.doNo,
    sap_ref: inv.sapRef,
    transporter_name: inv.transporterName,
    truck_id: inv.truckId,
    driver_mobile: inv.driverMobile,
    ship_from: inv.shipFrom,
    incoterm: inv.incoterm,
    irn: inv.irn,
    qr_payload: inv.qrPayload ?? null,
    eway_bill_no: inv.ewayBillNo,
    source_file_path: sourcePath(inv.companyId, inv.sourceFileUrl),
    import_batch_id: inv.importBatchId,
    taxable_paise: inv.totals.taxablePaise,
    sgst_paise: inv.totals.sgstPaise,
    cgst_paise: inv.totals.cgstPaise,
    igst_paise: inv.totals.igstPaise,
    round_off_paise: inv.totals.roundOffPaise,
    total_paise: inv.totals.totalPaise,
  };
}

const lineRows = (inv: Pick<TaxInvoice, "id" | "companyId" | "lines">) =>
  inv.lines.map((l) => ({
    id: l.id,
    company_id: inv.companyId,
    tax_invoice_id: inv.id,
    line_no: l.lineNo,
    item_id: l.itemId,
    item_code: l.itemCode,
    description: l.description,
    hsn: l.hsn,
    uom: l.uom,
    qty: l.qty,
    rate_paise: l.ratePaise,
    discount_paise: l.discountPaise,
    taxable_paise: l.taxablePaise,
    gst_rate_bp: l.gstRateBp,
    sgst_paise: l.sgstPaise,
    cgst_paise: l.cgstPaise,
    igst_paise: l.igstPaise,
  }));

/** Same seller + number in the same FY (cancelled invoices still hold theirs). */
function duplicateNoCheck(tx: Tx, inv: TaxInvoice, exceptId: string | null): Fragment | null {
  if (!inv.invoiceNo) return null;
  const fy = financialYear(invoiceDay(inv.invoiceAt));
  return tx`select ${fy}::text as fy from tax_invoices
             where company_id = ${inv.companyId} and invoice_no = ${inv.invoiceNo}
               and seller_party_id is not distinct from ${inv.sellerPartyId}::uuid
               and invoice_fy = ${fy}
               ${exceptId ? tx`and id <> ${exceptId}` : tx``}
             limit 1`;
}

const duplicateNoProblem = (inv: TaxInvoice) => (rows: Row[]) => {
  if (rows.length) fail("invoiceNo", `Invoice ${inv.invoiceNo} is already used in FY ${rows[0].fy}`);
};

/** Saves a draft (lines priced here); one read round trip, then the row + lines in one statement. */
export async function insertTaxInvoice(companyId: string, v: ParsedInput): Promise<TaxInvoice> {
  const sellerPartyId = v.sellerPartyId ?? null;
  return withUser(async (tx) => {
    const [[company], parties, problems, [batch]] = await Promise.all([
      tx`select * from companies where id = ${companyId}`,
      tx`select * from parties where company_id = ${companyId}
           and id in ${uuidsIn(tx, [sellerPartyId, v.billToId, v.shipToId])}`,
      runChecks(tx, refChecks(tx, companyId, v)),
      // The file this invoice was imported from: its e-invoice IRN and QR text travel with it.
      v.importBatchId
        ? tx`select result from import_batches
              where company_id = ${companyId} and id = ${v.importBatchId}`
        : Promise.resolve([] as Row[]),
    ]);
    const read = (batch?.result as { invoice?: { irn?: string | null; qrPayload?: string | null } } | undefined)
      ?.invoice;
    assertNoProblems(problems);
    // Own invoices get their number on Finalise only.
    const invoiceNo = sellerPartyId ? (v.invoiceNo ?? null) : null;
    assertImportedHasNo({ invoiceNo, sellerPartyId });
    const ctx = ctxFrom(company, parties);
    const ids = { sellerPartyId, billToId: v.billToId, shipToId: v.shipToId ?? null };
    const header: InvoiceHeader = {
      ...ids,
      placeOfSupplyStateCode: placeOfSupply(ctx, ids, v.placeOfSupplyStateCode ?? null),
    };
    const t = now();
    const priced = priceInvoice(ctx, header, v.lines);
    const inv: TaxInvoice = {
      id: newId(),
      companyId,
      createdAt: t,
      updatedAt: t,
      version: 1,
      createdBy: null,
      updatedBy: null,
      ...header,
      invoiceNo,
      invoiceAt: v.invoiceAt,
      status: "draft",
      customerRef: v.customerRef ?? null,
      customerRefDate: v.customerRefDate ?? null,
      soNo: v.soNo ?? null,
      soDate: v.soDate ?? null,
      doNo: v.doNo ?? null,
      sapRef: v.sapRef ?? null,
      transporterName: v.transporterName ?? null,
      truckId: v.truckId ?? null,
      driverMobile: v.driverMobile ?? null,
      shipFrom: v.shipFrom ?? null,
      incoterm: v.incoterm ?? null,
      lines: withDbQty(priced.lines),
      totals: priced.totals,
      irn: v.irn ?? read?.irn ?? null,
      qrPayload: read?.qrPayload ?? null,
      ewayBillNo: v.ewayBillNo ?? null,
      sourceFileUrl: v.sourceFileUrl ?? null,
      importBatchId: v.importBatchId ?? null,
      snapshot: null,
    };
    const lines = lineRows(inv);
    const [[saved]] = await checkedWrite<Row[][]>(
      duplicateNoCheck(tx, inv, null),
      [
        tx`with ins as (insert into tax_invoices ${tx({
          id: inv.id,
          company_id: companyId,
          status: "draft",
          ...invoiceColumns(tx, inv),
        } as never)} returning *)
           ${lines.length ? tx`, li as (insert into tax_invoice_lines ${tx(lines as never)})` : tx``}
           select ins.* from ins`,
      ],
      duplicateNoProblem(inv),
    );
    const out = toTaxInvoice({ ...saved, lines: inv.lines });
    audit(tx, companyId, "tax_invoices", inv.id, "create", null, out);
    return out;
  });
}

/** The invoice locked for an edit, with its company and parties (old and new) — one round trip. */
async function readForEdit(
  tx: Tx,
  companyId: string,
  id: string,
  partyIds: Array<string | null | undefined>,
  checks: Check[],
) {
  if (!isUuid(id)) throw new NotFoundError("Tax invoice");
  const [[cur], [company], parties, problems] = await Promise.all([
    tx`${INVOICE_SELECT(tx)} where t.company_id = ${companyId} and t.id = ${id} for update of t`,
    tx`select c.*, app.peek_number(c.id, 'tax_invoice', app.financial_year((
                 select (t.invoice_at at time zone 'Asia/Kolkata')::date from tax_invoices t
                  where t.company_id = c.id and t.id = ${id}))) as next_invoice_no
         from companies c where c.id = ${companyId}`,
    tx`select p.* from parties p
        where p.company_id = ${companyId}
          and (p.id in ${uuidsIn(tx, partyIds)}
               or p.id in (select unnest(array[seller_party_id, bill_to_id, ship_to_id])
                             from tax_invoices where company_id = ${companyId} and id = ${id}))`,
    runChecks(tx, checks),
  ]);
  return { cur, company, parties: parties as Row[], problems };
}

function assertEditable(cur: Row | undefined, expectedVersion: number): asserts cur is Row {
  if (!cur) throw new NotFoundError("Tax invoice");
  if (cur.cancelled_at) fail("", "This tax invoice is cancelled and can't be changed");
  if (cur.version !== expectedVersion) throw new ConflictError();
}

export async function updateTaxInvoice(
  companyId: string,
  id: string,
  expectedVersion: number,
  p: ParsedInvoicePatch,
): Promise<TaxInvoice> {
  return withUser(async (tx) => {
    const { cur, company, parties, problems } = await readForEdit(
      tx,
      companyId,
      id,
      [p.billToId, p.shipToId],
      refChecks(tx, companyId, p),
    );
    assertNoProblems(problems);
    assertEditable(cur, expectedVersion);
    const before = toTaxInvoice(cur);
    if (before.status === "final") {
      // Only the dates change: no re-pricing, and invoice_fy (the number's FY) stays put.
      const after = applyFinalInvoiceDates(before, p);
      const [updated] = await tx`
        update tax_invoices set ${tx({
          invoice_at: after.invoiceAt,
          customer_ref_date: after.customerRefDate,
          so_date: after.soDate,
        })}
         where company_id = ${companyId} and id = ${id} and version = ${expectedVersion}
     returning *`;
      if (!updated) throw new ConflictError();
      const out = toTaxInvoice({ ...updated, lines: before.lines });
      audit(tx, companyId, "tax_invoices", id, "update", before, out);
      return out;
    }
    const { next, typed } = applyInvoicePatch(before, p);
    const ctx = ctxFrom(company, parties);
    next.placeOfSupplyStateCode = placeOfSupply(ctx, next, typed);
    // Re-price every save: lines, parties or place of supply may have changed.
    const priced = priceInvoice(ctx, next, p.lines ?? before.lines);
    const after: TaxInvoice = { ...next, lines: withDbQty(priced.lines), totals: priced.totals };
    const linesChanged = JSON.stringify(after.lines) !== JSON.stringify(before.lines);
    const set: Row = invoiceColumns(tx, after);
    if (linesChanged) set.lines_rev = tx`lines_rev + 1`;
    const lines = lineRows(after);
    const [[updated]] = await checkedWrite<Row[][]>(
      duplicateNoCheck(tx, after, id),
      [
        tx`update tax_invoices set ${tx(set)}
            where company_id = ${companyId} and id = ${id} and version = ${expectedVersion}
        returning *`,
        ...(linesChanged
          ? [
              tx`delete from tax_invoice_lines where company_id = ${companyId} and tax_invoice_id = ${id}`,
              ...(lines.length ? [tx`insert into tax_invoice_lines ${tx(lines as never)}`] : []),
            ]
          : []),
      ],
      duplicateNoProblem(after),
    );
    if (!updated) throw new ConflictError();
    const out = toTaxInvoice({ ...updated, lines: after.lines });
    audit(tx, companyId, "tax_invoices", id, "update", before, out);
    return out;
  });
}

const partySnap = (parties: Row[], id: string) => {
  const p = parties.find((x) => x.id === id);
  if (!p) throw new NotFoundError("Party");
  return partySnapshot(toParty(p));
};

export async function finaliseTaxInvoice(
  companyId: string,
  id: string,
  expectedVersion: number,
): Promise<TaxInvoice> {
  return withUser(async (tx) => {
    if (!isUuid(id)) throw new NotFoundError("Tax invoice");
    const [{ cur, company, parties }, items] = await Promise.all([
      readForEdit(tx, companyId, id, [], []),
      tx`select i.id, i.last_rate_paise from items i
          where i.company_id = ${companyId} and i.cancelled_at is null
            and i.id in (select item_id from tax_invoice_lines
                          where company_id = ${companyId} and tax_invoice_id = ${id})`,
    ]);
    assertEditable(cur, expectedVersion);
    const before = toTaxInvoice(cur);
    if (before.status === "final") fail("", "Invoice is already final");

    const own = !before.sellerPartyId;
    const fy = financialYear(invoiceDay(before.invoiceAt));
    let invoiceNo = before.invoiceNo;
    if (own) {
      invoiceNo = formatInvoiceNo(company.tax_invoice_prefix, company.next_invoice_no ?? 1);
      if (!invoiceNo) fail("invoiceNo", INVOICE_NO_TOO_LONG);
    }
    const snapshot: NonNullable<TaxInvoice["snapshot"]> = {
      seller: before.sellerPartyId
        ? partySnap(parties, before.sellerPartyId)
        : companySnapshot(toCompany(company, null)),
      billTo: partySnap(parties, before.billToId),
      shipTo: before.shipToId ? partySnap(parties, before.shipToId) : null,
    };

    // Items remember the last rate they were sold at (the last line wins).
    const rates = new Map<string, number>();
    for (const l of before.lines) if (l.itemId) rates.set(l.itemId, l.ratePaise);
    const changedItems = (items as Row[])
      .filter((i) => rates.has(i.id) && i.last_rate_paise !== rates.get(i.id))
      .map((i) => ({ id: i.id as string, old: i.last_rate_paise as number | null, rate: rates.get(i.id)! }));

    // The number is taken in the same statement as the update; a failure gives it back.
    const numbered = own
      ? tx`with nx as (select n.no from app.allocate_number(${companyId}, 'tax_invoice', ${fy}) n)
           update tax_invoices t
              set status = 'final', snapshot = ${tx.json(snapshot as never)}, invoice_fy = ${fy},
                  invoice_seq = nx.no,
                  invoice_no = ${company.tax_invoice_prefix}::text
                               || case when nx.no < 1000 then lpad(nx.no::text, 3, '0') else nx.no::text end
             from nx
            where t.company_id = ${companyId} and t.id = ${id} and t.version = ${expectedVersion}
        returning t.*`
      : tx`update tax_invoices set status = 'final', snapshot = ${tx.json(snapshot as never)}
            where company_id = ${companyId} and id = ${id} and version = ${expectedVersion}
        returning *`;
    const after: TaxInvoice = { ...before, invoiceNo };
    const itemUpdate = changedItems.length
      ? tx`update items i set last_rate_paise = v.rate::bigint
             from (select (x->>'id')::uuid as id, (x->>'rate')::bigint as rate
                     from jsonb_array_elements(${tx.json(changedItems as never)}::jsonb) x) v
            where i.company_id = ${companyId} and i.id = v.id
        returning i.id`
      : null;
    const [[updated], updatedItems] = await checkedWrite<Row[][]>(
      own ? duplicateNoCheck(tx, after, id) : null,
      itemUpdate ? [numbered, itemUpdate] : [numbered],
      duplicateNoProblem(after),
    );
    if (!updated) throw new ConflictError();
    const out = toTaxInvoice({ ...updated, lines: before.lines });
    audit(tx, companyId, "tax_invoices", id, "update", before, out);
    // RLS skips items this role may not edit; only the ones changed get an audit row.
    for (const r of updatedItems ?? []) {
      const c = changedItems.find((x) => x.id === r.id)!;
      audit(tx, companyId, "items", c.id, "update", { lastRatePaise: c.old }, { lastRatePaise: c.rate });
    }
    return out;
  });
}

export async function cancelTaxInvoice(
  companyId: string,
  id: string,
  reason: string,
): Promise<TaxInvoice> {
  return withUser(async (tx) => {
    if (!isUuid(id)) throw new NotFoundError("Tax invoice");
    const { before, after, changed } = await cancelRow(
      tx,
      "tax_invoices",
      companyId,
      id,
      "Tax invoice",
      reason,
      (a) => tx`, ${linesJson(tx, a)} as lines`,
    );
    if (changed) audit(tx, companyId, "tax_invoices", id, "cancel", toTaxInvoice(before), toTaxInvoice(after));
    return toTaxInvoice(after);
  });
}

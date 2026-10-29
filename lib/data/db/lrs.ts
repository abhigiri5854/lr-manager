// LRs on the database (DATA_SOURCE=db). Same behaviour as the mock half of ../lrs.ts.
// Saves follow the fast patterns (CLAUDE.md): the read an edit needs is one pipelined round trip,
// the write is one combined statement (number + row + lines), and the audit row leaves with the
// commit. The goods / invoice lines are part of the LR record: an edit that changes only lines
// bumps lrs.lines_rev so the row (and its version) still changes.
import { financialYear } from "@/lib/fy";
import { companySnapshot, partySnapshot } from "@/lib/snapshots";
import type { ChargedAs, GstPayer, Lr, LrPaymentMode, LrSnapshot, LrStatus, LrView, Page } from "@/lib/types";
import { normaliseVehicleNo } from "@/lib/validators/common";
import { lrBookingErrors } from "@/lib/validators/lr";
import { assertRules, fail, now, today } from "../_store";
import { ConflictError, NotFoundError } from "../errors";
import {
  applyPatch,
  lockedLrDates,
  lockedOnBill,
  type ParsedPatch,
  type SaveLrOptions,
} from "../lr-patch";
import type { ConsignorDefaults, LrListParams, LrRef } from "../lrs";
import { contains, paging, withUser, withUserRead, type Tx } from "./conn";
import { uuidList } from "./parties";
import { audit, toCompany, toLr, toLrView, toParty, type Row } from "./rows";
import {
  assertNoProblems,
  cancelRow,
  check,
  checksSql,
  saveRow,
  type Check,
  type Fragment,
} from "./write";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string | undefined | null): s is string => !!s && UUID.test(s);

// ---------- the LR as a view row ----------
/** Goods lines as json, keyed like the Lr record (alias `a` = a lrs row or a CTE of one). */
const itemsJson = (tx: Tx, a: Fragment) => tx`coalesce((select json_agg(json_build_object(
    'id', i.id, 'itemId', i.item_id, 'description', i.description, 'packages', i.packages,
    'actualWeight', i.actual_weight::text, 'chargedWeight', i.charged_weight::text, 'size', i.size)
    order by i.position)
  from lr_items i where i.company_id = ${a}.company_id and i.lr_id = ${a}.id), '[]')`;

const invoicesJson = (tx: Tx, a: Fragment) => tx`coalesce((select json_agg(json_build_object(
    'id', v.id, 'invoiceNo', v.invoice_no, 'invoiceDate', v.invoice_date, 'valuePaise', v.value_paise,
    'ewayBillNo', v.eway_bill_no, 'ewayExpiresAt', v.eway_expires_at, 'taxInvoiceId', v.tax_invoice_id)
    order by v.position)
  from lr_invoices v where v.company_id = ${a}.company_id and v.lr_id = ${a}.id), '[]')`;

/** Party names and truck number next to a saved row (LrView), as `, …` columns. */
const namesCols = (tx: Tx) => (a: Fragment) => tx`,
  (select name from parties where company_id = ${a}.company_id and id = ${a}.consignor_id) as consignor_name,
  (select name from parties where company_id = ${a}.company_id and id = ${a}.consignee_id) as consignee_name,
  (select name from parties where company_id = ${a}.company_id and id = ${a}.billed_to_id) as billed_to_name,
  (select number from trucks where company_id = ${a}.company_id and id = ${a}.truck_id) as truck_number`;

/** Lines + names: the extra columns of every LR view. */
export const lrViewCols = (tx: Tx) => (a: Fragment) =>
  tx`, ${itemsJson(tx, a)} as items, ${invoicesJson(tx, a)} as invoices ${namesCols(tx)(a)}`;

export const LR_SELECT = (tx: Tx) => tx`select l.* ${lrViewCols(tx)(tx`l`)} from lrs l`;

/** SQL twin of deriveLrStatus (lib/lr-status.ts) on alias `l`. */
export const STATUS_SQL = `(case when l.cancelled_at is not null then 'Cancelled'
  when l.booked_at is null then 'Draft' when l.paid_at is not null then 'Paid'
  when l.billed_at is not null then 'Billed' when l.pod_received_at is not null then 'POD received'
  when l.delivered_at is not null then 'Delivered' when l.dispatched_at is not null then 'In transit'
  else 'Booked' end)`;

/** Goods are still moving (draft, booked, in transit) on alias `l` — twin of isGoodsMoving. */
export const MOVING_SQL = `(l.cancelled_at is null and (l.booked_at is null or (l.paid_at is null
  and l.billed_at is null and l.pod_received_at is null and l.delivered_at is null)))`;

// ---------- reads ----------
export type DbLrListParams = LrListParams & { statuses?: LrStatus[] };

function lrWhere(tx: Tx, companyId: string, p: DbLrListParams) {
  const q = contains(p.search);
  // "br 01 gn 8331" should find BR01GN8331 (search_text holds the truck number as typed).
  const truck = p.search ? contains(normaliseVehicleNo(p.search)) : null;
  const uuidFilter = (col: string, id: string | undefined) =>
    id === undefined ? tx`` : isUuid(id) ? tx`and ${tx.unsafe(col)} = ${id}` : tx`and false`;
  return tx`l.company_id = ${companyId}
    ${p.status === "Cancelled" ? tx`and l.cancelled_at is not null` : tx`and l.cancelled_at is null`}
    ${uuidFilter("l.truck_id", p.truckId)}
    ${
      p.partyId === undefined
        ? tx``
        : isUuid(p.partyId)
          ? tx`and ${p.partyId} in (l.consignor_id, l.consignee_id, l.billed_to_id)`
          : tx`and false`
    }
    ${p.dateFrom ? tx`and l.lr_date >= ${p.dateFrom}` : tx``}
    ${p.dateTo ? tx`and l.lr_date <= ${p.dateTo}` : tx``}
    ${p.status ? tx`and ${tx.unsafe(STATUS_SQL)} = ${p.status}` : tx``}
    ${p.statuses ? tx`and ${tx.unsafe(STATUS_SQL)} in ${tx(p.statuses)}` : tx``}
    ${
      q
        ? tx`and (l.search_text like ${q} ${truck ? tx`or l.search_text like ${truck}` : tx``})`
        : tx``
    }`;
}

export async function listLrs(companyId: string, params: DbLrListParams): Promise<Page<LrView>> {
  const { page, pageSize, offset } = paging(params);
  return withUserRead(async (tx) => {
    const where = () => lrWhere(tx, companyId, params);
    const [rows, [{ n }]] = await Promise.all([
      tx`${LR_SELECT(tx)} where ${where()} order by l.created_at desc, l.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from lrs l where ${where()}`,
    ]);
    return { rows: rows.map(toLrView), total: n as number, page, pageSize };
  });
}

export async function listLrsForExport(
  companyId: string,
  params: DbLrListParams,
  limit: number,
): Promise<{ rows: LrView[]; total: number }> {
  return withUserRead(async (tx) => {
    const where = () => lrWhere(tx, companyId, params);
    const [rows, [{ n }]] = await Promise.all([
      tx`${LR_SELECT(tx)} where ${where()} order by l.created_at desc, l.id limit ${limit}`,
      tx`select count(*) as n from lrs l where ${where()}`,
    ]);
    return { rows: rows.map(toLrView), total: n as number };
  });
}

export async function getLrById(companyId: string, id: string): Promise<LrView | null> {
  if (!isUuid(id)) return null;
  return withUserRead(async (tx) => {
    const [r] = await tx`${LR_SELECT(tx)} where l.company_id = ${companyId} and l.id = ${id}`;
    return r ? toLrView(r) : null;
  });
}

export async function peekNextLrNo(companyId: string, fy: string): Promise<string | null> {
  return withUserRead(async (tx) => {
    const [r] = await tx`select c.lr_prefix, app.peek_number(c.id, 'lr', ${fy}) as n
                           from companies c where c.id = ${companyId}`;
    return !r || r.n === null ? null : `${r.lr_prefix}${r.n}`;
  });
}

export async function getConsignorDefaults(
  companyId: string,
  consignorId: string,
): Promise<ConsignorDefaults | null> {
  if (!isUuid(consignorId)) return null;
  return withUserRead(async (tx) => {
    const [[last], [party]] = await Promise.all([
      tx`select id, lr_no, from_place, charged_as, payment_mode, gst_paid_by from lrs
          where company_id = ${companyId} and consignor_id = ${consignorId}
            and cancelled_at is null and booked_at is not null
          order by booked_at desc limit 1`,
      tx`select default_from, default_charged_as, default_payment_mode, default_gst_payer
           from parties where company_id = ${companyId} and id = ${consignorId}`,
    ]);
    if (last) {
      return {
        lrId: last.id,
        lrNo: last.lr_no,
        fromPlace: last.from_place,
        chargedAs: last.charged_as as ChargedAs | null,
        paymentMode: last.payment_mode as LrPaymentMode | null,
        gstPaidBy: last.gst_paid_by as GstPayer | null,
      };
    }
    if (
      !party ||
      (!party.default_from &&
        !party.default_charged_as &&
        !party.default_payment_mode &&
        !party.default_gst_payer)
    ) {
      return null;
    }
    return {
      lrId: null,
      lrNo: null,
      fromPlace: party.default_from,
      chargedAs: party.default_charged_as,
      paymentMode: party.default_payment_mode,
      gstPaidBy: party.default_gst_payer,
    };
  });
}

export async function findLrsWithInvoice(
  companyId: string,
  taxInvoiceId: string | null,
  invoiceNo: string,
  exceptLrId: string | undefined,
): Promise<LrRef[]> {
  return withUserRead(async (tx) => {
    const rows = await tx`
      select l.id, l.lr_no from lrs l
       where l.company_id = ${companyId} and l.cancelled_at is null
         and l.id is distinct from ${isUuid(exceptLrId) ? exceptLrId : null}
         and exists (select 1 from lr_invoices v
                      where v.company_id = l.company_id and v.lr_id = l.id
                        and (${taxInvoiceId && isUuid(taxInvoiceId) ? tx`v.tax_invoice_id = ${taxInvoiceId}` : tx`false`}
                             or ${invoiceNo ? tx`upper(regexp_replace(v.invoice_no, '[[:space:]]+', '', 'g')) = ${invoiceNo}` : tx`false`}))
       order by l.created_at desc, l.id`;
    return rows.map((r) => ({ id: r.id as string, lrNo: r.lr_no as string }));
  });
}

export async function getConsigneeToPlace(
  companyId: string,
  consigneeId: string,
): Promise<string | null> {
  if (!isUuid(consigneeId)) return null;
  return withUserRead(async (tx) => {
    const [r] = await tx`
      select coalesce(
        (select to_place from lrs where company_id = ${companyId} and consignee_id = ${consigneeId}
            and cancelled_at is null and booked_at is not null and nullif(to_place, '') is not null
          order by booked_at desc limit 1),
        (select place from parties where company_id = ${companyId} and id = ${consigneeId})) as place`;
    return (r?.place as string | null) ?? null;
  });
}

// ---------- writes ----------
const isoOrNull = (v: string | null) => (v === null ? null : new Date(v).toISOString());

/** Nested lines as the database returns them (e-way expiry as an ISO moment). */
function lrInvoicesForDb<T extends { ewayExpiresAt: string | null }>(list: T[]): T[] {
  return list.map((i) => ({ ...i, ewayExpiresAt: isoOrNull(i.ewayExpiresAt) }));
}

/** Weights as the column keeps them (numeric(12,3)), so a saved LR compares equal to a re-read one. */
const weight = (w: string | null) => (w === null ? null : Number(w).toFixed(3));
const itemsForDb = (list: Lr["items"]): Lr["items"] =>
  list.map((i) => ({ ...i, actualWeight: weight(i.actualWeight), chargedWeight: weight(i.chargedWeight) }));

/** Every id an LR points at must belong to this company and not be cancelled. */
function refChecks(
  tx: Tx,
  companyId: string,
  v: Partial<
    Pick<Lr, "consignorId" | "consigneeId" | "billedToId" | "truckId" | "items" | "lrInvoices">
  >,
): Check[] {
  const ref = (table: string, field: string, what: string, id: string | null | undefined) =>
    id
      ? [
          check(
            tx,
            field,
            `${what} not found in this company`,
            tx`not exists (select 1 from ${tx(table)} where company_id = ${companyId} and id = ${id}
                             and cancelled_at is null)`,
          ),
        ]
      : [];
  return [
    ...ref("parties", "consignorId", "Consignor", v.consignorId),
    ...ref("parties", "consigneeId", "Consignee", v.consigneeId),
    ...ref("parties", "billedToId", "Billed-to party", v.billedToId),
    ...ref("trucks", "truckId", "Truck", v.truckId),
    ...(v.lrInvoices ?? []).flatMap((inv, i) =>
      ref("tax_invoices", `lrInvoices.${i}.taxInvoiceId`, "Tax invoice", inv.taxInvoiceId),
    ),
    ...(v.items ?? []).flatMap((item, i) =>
      ref("items", `items.${i}.itemId`, "Item", item.itemId),
    ),
  ];
}

const runChecks = (tx: Tx, checks: Check[]) =>
  checks.length
    ? tx`select field, msg from (${checksSql(tx, checks)}) c`.execute()
    : Promise.resolve([] as Row[]);

/** lrs columns an edit can set, from the full record. */
function lrColumns(tx: Tx, lr: Lr): Row {
  const c = lr.charges;
  return {
    lr_date: lr.lrDate,
    from_place: lr.fromPlace,
    to_place: lr.toPlace,
    risk: lr.risk,
    consignor_id: lr.consignorId,
    consignee_id: lr.consigneeId,
    billed_to_id: lr.billedToId,
    gst_paid_by: lr.gstPaidBy,
    payment_mode: lr.paymentMode,
    charged_as: lr.chargedAs,
    rate_paise: lr.ratePaise,
    truck_id: lr.truckId,
    driver_mobile: lr.driverMobile,
    remarks: lr.remarks,
    freight_paise: c.freight,
    packing_paise: c.packing,
    cn_charge_paise: c.cnCharge,
    loading_paise: c.loading,
    unloading_paise: c.unloading,
    detention_paise: c.detention,
    other_paise: c.other,
    gst_paise: c.gst,
    advance_paise: c.advance,
    booked_at: lr.bookedAt,
    snapshot: lr.snapshot ? tx.json(lr.snapshot as never) : null,
  };
}

const itemRows = (lr: Pick<Lr, "id" | "companyId" | "items">) =>
  lr.items.map((i, position) => ({
    id: i.id,
    company_id: lr.companyId,
    lr_id: lr.id,
    position,
    item_id: i.itemId,
    description: i.description,
    packages: i.packages,
    actual_weight: i.actualWeight,
    charged_weight: i.chargedWeight,
    size: i.size,
  }));

const invoiceRows = (lr: Pick<Lr, "id" | "companyId" | "lrInvoices">) =>
  lr.lrInvoices.map((i, position) => ({
    id: i.id,
    company_id: lr.companyId,
    lr_id: lr.id,
    position,
    invoice_no: i.invoiceNo,
    invoice_date: i.invoiceDate,
    value_paise: i.valuePaise,
    eway_bill_no: i.ewayBillNo,
    eway_expires_at: i.ewayExpiresAt,
    tax_invoice_id: i.taxInvoiceId,
  }));

/** The snapshot a booked LR keeps: company + parties as they are now. */
function snapshotFrom(
  company: Row,
  parties: Map<string, Row>,
  lr: Pick<Lr, "consignorId" | "consigneeId" | "billedToId">,
): LrSnapshot {
  const party = (id: string | null) => {
    const p = id ? parties.get(id) : undefined;
    return p ? partySnapshot(toParty(p)) : null;
  };
  return {
    company: companySnapshot(toCompany(company, null)),
    consignor: party(lr.consignorId),
    consignee: party(lr.consigneeId),
    billedTo: party(lr.billedToId),
  };
}

const partiesById = (rows: Row[]) => new Map(rows.map((p) => [p.id as string, p]));

/** The company and these parties, for a snapshot (one pipelined round trip with other reads). */
function snapshotSources(tx: Tx, companyId: string, partyIds: (string | null | undefined)[]) {
  const ids = partyIds.filter((x): x is string => !!x);
  return Promise.all([
    tx`select * from companies where id = ${companyId}`,
    tx`select * from parties where company_id = ${companyId}
          and id = any (string_to_array(${uuidList(ids)}, ',')::uuid[])`,
  ]);
}

/** Creates the LR (draft, or booked when lr.bookedAt is set) and takes its number — one statement. */
export async function insertLr(source: Lr): Promise<LrView> {
  const companyId = source.companyId;
  const lr: Lr = {
    ...source,
    items: itemsForDb(source.items),
    lrInvoices: lrInvoicesForDb(source.lrInvoices),
  };
  const fy = financialYear(lr.lrDate ?? today());
  return withUser(async (tx) => {
    const checks = refChecks(tx, companyId, lr);
    let snapshot: LrSnapshot | null = null;
    let checked = false;
    if (lr.bookedAt) {
      // The snapshot needs the company and the parties first.
      const [[[company], parties], problems] = await Promise.all([
        snapshotSources(tx, companyId, [lr.consignorId, lr.consigneeId, lr.billedToId]),
        runChecks(tx, checks),
      ]);
      assertNoProblems(problems as { field: string; msg: string }[]);
      checked = true;
      snapshot = snapshotFrom(company, partiesById(parties), lr);
    }
    const pendingChecks = checked ? Promise.resolve([] as Row[]) : runChecks(tx, checks);
    const insert = insertWithLines(
      tx,
      lr,
      snapshot,
      tx`with nx as (select p.lr_prefix || n.no::text as lr_no, n.no
                       from app.allocate_number(${companyId}, 'lr', ${fy}) n
                       join companies p on p.id = ${companyId})`,
      { lr_no: tx`(select lr_no from nx)`, lr_fy: fy, lr_seq: tx`(select no from nx)` },
    );
    // Checks and insert travel together (checks first on the connection), so an FK error never
    // hides the friendly message.
    const [c, i] = await Promise.allSettled([pendingChecks, insert]);
    if (c.status === "rejected") throw c.reason;
    assertNoProblems(c.value as { field: string; msg: string }[]);
    if (i.status === "rejected") throw i.reason;
    const saved = { ...i.value, items: lr.items, invoices: lr.lrInvoices };
    audit(tx, companyId, "lrs", lr.id, "create", null, toLr(saved));
    return toLrView(saved);
  });
}

/**
 * The LR row, then its lines in their own statements right behind it (one round trip). Separate
 * statements so the line triggers see the new LR (its search text picks up invoice nos.).
 */
async function insertWithLines(
  tx: Tx,
  lr: Lr,
  snapshot: LrSnapshot | null,
  prelude: Fragment | null,
  numberCols: Row,
): Promise<Row> {
  const items = itemRows(lr);
  const invoices = invoiceRows(lr);
  const [[row]] = await Promise.all([
    tx`${prelude ? tx`${prelude},` : tx`with`} ins as (insert into lrs ${tx({
      id: lr.id,
      company_id: lr.companyId,
      ...numberCols,
      import_batch_id: lr.importBatchId ?? null,
      ...lrColumns(tx, { ...lr, snapshot }),
    } as never)} returning *)
      select ins.* ${namesCols(tx)(tx`ins`)} from ins`.execute(),
    ...(items.length ? [tx`insert into lr_items ${tx(items as never)}`.execute()] : []),
    ...(invoices.length ? [tx`insert into lr_invoices ${tx(invoices as never)}`.execute()] : []),
  ]);
  return row;
}

/**
 * Smart import: a draft LR keeping the sheet's number (company prefix + digits), and the LR
 * series moved past it so the next new LR can't collide — all in one round trip.
 */
export async function insertImportedLr(source: Lr, seq: number, fy: string): Promise<LrView> {
  const companyId = source.companyId;
  const lr: Lr = {
    ...source,
    items: itemsForDb(source.items),
    lrInvoices: lrInvoicesForDb(source.lrInvoices),
  };
  return withUser(async (tx) => {
    const checks = [
      check(
        tx,
        "lrNo",
        `LR ${lr.lrNo} already exists`,
        tx`exists (select 1 from lrs where company_id = ${companyId} and lr_no = ${lr.lrNo})`,
      ),
      ...refChecks(tx, companyId, lr),
    ];
    const pendingChecks = runChecks(tx, checks);
    const insert = insertWithLines(tx, lr, null, null, { lr_no: lr.lrNo, lr_fy: fy, lr_seq: seq });
    const raise = tx`select app.raise_number(${companyId}, 'lr', ${fy},
                       greatest(${seq + 1}::bigint, coalesce(app.peek_number(${companyId}, 'lr', ${fy}), 0)))`.execute();
    const [c, i, r] = await Promise.allSettled([pendingChecks, insert, raise]);
    if (c.status === "rejected") throw c.reason;
    assertNoProblems(c.value as { field: string; msg: string }[]);
    if (i.status === "rejected") throw i.reason;
    if (r.status === "rejected") throw r.reason;
    const saved = { ...i.value, items: lr.items, invoices: lr.lrInvoices };
    audit(tx, companyId, "lrs", lr.id, "create", null, toLr(saved));
    return toLrView(saved);
  });
}

/** The LR locked for an edit, with what a snapshot and the rules need — one pipelined round trip. */
async function readForEdit(
  tx: Tx,
  companyId: string,
  id: string,
  partyIds: (string | null | undefined)[],
  checks: Check[],
) {
  if (!isUuid(id)) throw new NotFoundError("LR");
  const ids = partyIds.filter((x): x is string => !!x);
  const [[cur], parties, problems] = await Promise.all([
    tx`select l.* ${lrViewCols(tx)(tx`l`)},
              (select to_jsonb(c.*) from companies c where c.id = l.company_id) as company_row,
              (select json_build_object('bill_no', b.bill_no, 'status', b.status)
                 from freight_bill_lines fl
                 join freight_bills b on b.company_id = fl.company_id and b.id = fl.freight_bill_id
                where fl.company_id = l.company_id and fl.lr_id = l.id and fl.bill_cancelled_at is null
                limit 1) as bill
         from lrs l where l.company_id = ${companyId} and l.id = ${id} for update of l`,
    tx`select p.* from parties p
        where p.company_id = ${companyId}
          and (p.id = any (string_to_array(${uuidList(ids)}, ',')::uuid[])
               or p.id in (select unnest(array[consignor_id, consignee_id, billed_to_id]) from lrs
                            where company_id = ${companyId} and id = ${id}))`,
    runChecks(tx, checks),
  ]);
  if (!cur) throw new NotFoundError("LR");
  return { cur, parties: partiesById(parties), problems: problems as { field: string; msg: string }[] };
}

export async function updateLr(
  companyId: string,
  id: string,
  expectedVersion: number,
  p: ParsedPatch,
  nested: { items?: Lr["items"]; lrInvoices?: Lr["lrInvoices"] },
  options: SaveLrOptions,
): Promise<LrView> {
  const invoices = nested.lrInvoices && lrInvoicesForDb(nested.lrInvoices);
  const lines = nested.items && itemsForDb(nested.items);
  return withUser(async (tx) => {
    const { cur, parties, problems } = await readForEdit(
      tx,
      companyId,
      id,
      [p.consignorId, p.consigneeId, p.billedToId],
      refChecks(tx, companyId, { ...p, items: lines, lrInvoices: invoices }),
    );
    const lockedBy = cur.bill?.status === "final" ? (cur.bill.bill_no as string | null) : undefined;
    assertNoProblems(problems);
    if (cur.cancelled_at) fail("", "This lr is cancelled and can't be changed");
    if (cur.version !== expectedVersion) throw new ConflictError();

    const before = toLr(cur);
    const patched = applyPatch(
      before,
      p,
      { items: lines, lrInvoices: invoices },
      options,
      (lr) => snapshotFrom(cur.company_row, parties, lr),
      now(),
    );
    // On a final freight bill only the dates may change.
    const next =
      lockedBy === undefined
        ? patched
        : (lockedLrDates(before, patched) ?? fail("", lockedOnBill(lockedBy)));
    const itemsChanged = JSON.stringify(next.items) !== JSON.stringify(before.items);
    const invoicesChanged = JSON.stringify(next.lrInvoices) !== JSON.stringify(before.lrInvoices);
    const set: Row = lrColumns(tx, next);
    if (itemsChanged || invoicesChanged) set.lines_rev = tx`lines_rev + 1`;

    // In order on one connection, sent together: the row, then its replaced lines.
    const statements = [
      tx`with u as (update lrs set ${tx(set)}
                     where company_id = ${companyId} and id = ${id} and version = ${expectedVersion}
                 returning *)
         select u.* ${namesCols(tx)(tx`u`)} from u`,
    ];
    const replace = (table: "lr_items" | "lr_invoices", rows: Row[]) => {
      statements.push(
        tx`delete from ${tx(table)} where company_id = ${companyId} and lr_id = ${id}`,
        ...(rows.length ? [tx`insert into ${tx(table)} ${tx(rows as never)}`] : []),
      );
    };
    if (itemsChanged) replace("lr_items", itemRows(next));
    if (invoicesChanged) replace("lr_invoices", invoiceRows(next));
    const [updated] = await Promise.all(statements);
    if (!updated[0]) throw new ConflictError();

    const saved = { ...updated[0], items: next.items, invoices: next.lrInvoices };
    audit(tx, companyId, "lrs", id, "update", before, toLr(saved));
    return toLrView(saved);
  });
}

export async function bookLr(
  companyId: string,
  id: string,
  expectedVersion: number,
): Promise<LrView> {
  return withUser(async (tx) => {
    const { cur, parties } = await readForEdit(tx, companyId, id, [], []);
    if (cur.cancelled_at) fail("", "This lr is cancelled and can't be changed");
    if (cur.version !== expectedVersion) throw new ConflictError();
    const before = toLr(cur);
    if (before.bookedAt) fail("", "LR is already booked");
    assertRules(lrBookingErrors(before));
    const bookedAt = now();
    const snapshot = snapshotFrom(cur.company_row, parties, before);
    const [updated] = await tx`
      with u as (update lrs set booked_at = ${bookedAt}, snapshot = ${tx.json(snapshot as never)}
                  where company_id = ${companyId} and id = ${id} and version = ${expectedVersion}
              returning *)
      select u.* ${namesCols(tx)(tx`u`)} from u`;
    if (!updated) throw new ConflictError();
    const saved = { ...updated, items: before.items, invoices: before.lrInvoices };
    audit(tx, companyId, "lrs", id, "update", before, toLr(saved));
    return toLrView(saved);
  });
}

export async function dispatchLr(
  companyId: string,
  id: string,
  expectedVersion: number,
): Promise<LrView> {
  return withUser(async (tx) => {
    if (!isUuid(id)) throw new NotFoundError("LR");
    const { before, after } = await saveRow(
      tx,
      "lrs",
      companyId,
      id,
      expectedVersion,
      { dispatched_at: tx`coalesce(cur.dispatched_at, now())` },
      {
        what: "LR",
        extra: lrViewCols(tx),
        validate: (b) => {
          if (!b.booked_at) fail("", "Book the LR before dispatching it");
          if (!b.truck_id) fail("truckId", "Pick a truck before dispatching");
        },
      },
    );
    audit(tx, companyId, "lrs", id, "update", toLr(before), toLr(after));
    return toLrView(after);
  });
}

export async function cancelLr(companyId: string, id: string, reason: string): Promise<LrView> {
  return withUser(async (tx) => {
    if (!isUuid(id)) throw new NotFoundError("LR");
    const [bill] = await tx`select b.bill_no from freight_bill_lines fl
           join freight_bills b on b.company_id = fl.company_id and b.id = fl.freight_bill_id
          where fl.company_id = ${companyId} and fl.lr_id = ${id} and fl.bill_cancelled_at is null
          limit 1`;
    if (bill) {
      fail("", `LR is on freight bill ${bill.bill_no ?? "(draft)"} — remove it from the bill first`);
    }
    const { before, after, changed } = await cancelRow(
      tx,
      "lrs",
      companyId,
      id,
      "LR",
      reason,
      lrViewCols(tx),
    );
    if (changed) audit(tx, companyId, "lrs", id, "cancel", toLr(before), toLr(after));
    return toLrView(after);
  });
}

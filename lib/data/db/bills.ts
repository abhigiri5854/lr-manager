// Freight bills and payments on the database. Same behaviour as the mock half of ../bills.ts.
// LR stamps (billed / paid) are kept by triggers (0002: g_lr_stamps), so nothing here touches
// lrs. Child rows (bill lines, allocations) go in their own statement right after the parent —
// pipelined in the same round trip — because their triggers read the parent row.
import { financialYear } from "@/lib/fy";
import { companySnapshot, partySnapshot } from "@/lib/snapshots";
import type { FreightBill, FreightBillView, LrView, Page, Payment } from "@/lib/types";
import type { freightBillFields, freightBillPatchSchema } from "@/lib/validators/bill";
import { fail, newId, now } from "../_store";
import {
  assertBillableLrs,
  BILL_FINAL,
  BILL_HAS_PAYMENTS,
  checkAllocations,
  priceBill,
  type LrForBill,
  type ParsedPayment,
} from "../bill-calc";
import type { FreightBillListParams, PaymentListParams } from "../bills";
import { ConflictError, NotFoundError } from "../errors";
import { contains, paging, withUser, withUserRead, type Tx } from "./conn";
import { isUuid, LR_SELECT } from "./lrs";
import { audit, toCompany, toFreightBill, toLrView, toParty, toPayment, type Row } from "./rows";
import {
  assertNoProblems,
  cancelRow,
  checkedWrite,
  refCheck,
  runChecks,
  uuidsIn,
  type Fragment,
} from "./write";

type ParsedBill = ReturnType<typeof freightBillFields.parse>;
type ParsedBillPatch = ReturnType<typeof freightBillPatchSchema.parse>;

// ---------- freight bills: reading ----------
/** Lines, party name, received so far and LR nos. next to a bill row (alias `a`). */
const billViewCols = (tx: Tx) => (a: Fragment) => tx`,
  coalesce((select json_agg(json_build_object(
      'id', fl.id, 'lrId', fl.lr_id, 'freightPaise', fl.freight_paise,
      'detentionPaise', fl.detention_paise, 'otherPaise', fl.other_paise,
      'advancePaise', fl.advance_paise, 'totalPaise', fl.total_paise) order by fl.position)
    from freight_bill_lines fl
   where fl.company_id = ${a}.company_id and fl.freight_bill_id = ${a}.id), '[]') as lines,
  (select name from parties where company_id = ${a}.company_id and id = ${a}.party_id) as party_name,
  (select coalesce(sum(al.amount_paise), 0)::bigint
     from payment_allocations al
     join payments p on p.company_id = al.company_id and p.id = al.payment_id
    where al.company_id = ${a}.company_id and al.freight_bill_id = ${a}.id
      and p.cancelled_at is null) as received_paise,
  coalesce((select json_agg(coalesce(l.lr_no, '') order by fl.position)
     from freight_bill_lines fl
     left join lrs l on l.company_id = fl.company_id and l.id = fl.lr_id
    where fl.company_id = ${a}.company_id and fl.freight_bill_id = ${a}.id), '[]') as lr_nos`;

const BILL_SELECT = (tx: Tx) => tx`select b.* ${billViewCols(tx)(tx`b`)} from freight_bills b`;

function toBillView(r: Row): FreightBillView {
  const bill = toFreightBill(r);
  const received = (r.received_paise as number) ?? 0;
  return {
    ...bill,
    partyName: r.party_name ?? "",
    receivedPaise: received,
    duePaise: bill.status === "final" && !bill.cancelledAt ? bill.totals.amountPaise - received : 0,
    lrNos: r.lr_nos as string[],
  };
}

function billWhere(tx: Tx, companyId: string, p: FreightBillListParams) {
  const q = contains(p.search);
  return tx`b.company_id = ${companyId} and b.cancelled_at is null
    ${
      p.partyId === undefined
        ? tx``
        : isUuid(p.partyId)
          ? tx`and b.party_id = ${p.partyId}`
          : tx`and false`
    }
    ${p.status ? tx`and b.status = ${p.status}` : tx``}
    ${q ? tx`and b.search_text like ${q}` : tx``}`;
}

export async function listFreightBills(
  companyId: string,
  params: FreightBillListParams,
): Promise<Page<FreightBillView>> {
  const { page, pageSize, offset } = paging(params);
  return withUserRead(async (tx) => {
    const [rows, [{ n }]] = await Promise.all([
      tx`${BILL_SELECT(tx)} where ${billWhere(tx, companyId, params)}
          order by b.bill_date desc, b.created_at desc, b.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from freight_bills b where ${billWhere(tx, companyId, params)}`,
    ]);
    return { rows: rows.map(toBillView), total: n as number, page, pageSize };
  });
}

export async function getFreightBillById(
  companyId: string,
  id: string,
): Promise<FreightBillView | null> {
  if (!isUuid(id)) return null;
  return withUserRead(async (tx) => {
    const [r] = await tx`${BILL_SELECT(tx)} where b.company_id = ${companyId} and b.id = ${id}`;
    return r ? toBillView(r) : null;
  });
}

/** Booked live LRs on no live bill; billed to the party (its billed-to party, else consignee). */
export async function listUnbilledLrs(companyId: string, partyId?: string): Promise<LrView[]> {
  if (partyId !== undefined && !isUuid(partyId)) return [];
  return withUserRead(async (tx) => {
    const rows = await tx`${LR_SELECT(tx)}
      where l.company_id = ${companyId} and l.cancelled_at is null and l.booked_at is not null
        and not exists (select 1 from freight_bill_lines fl
                         where fl.company_id = l.company_id and fl.lr_id = l.id
                           and fl.bill_cancelled_at is null)
        ${partyId ? tx`and coalesce(l.billed_to_id, l.consignee_id) = ${partyId}` : tx``}
      order by l.created_at, l.id`;
    return rows.map(toLrView);
  });
}

// ---------- freight bills: writing ----------
/** What the billable-LR checks need about these LRs (one query). */
function lrsForBill(tx: Tx, companyId: string, ids: string[]) {
  return tx`
    select l.id, l.lr_no, l.booked_at, l.cancelled_at,
           (select json_build_object('id', b.id, 'billNo', b.bill_no)
              from freight_bill_lines fl
              join freight_bills b on b.company_id = fl.company_id and b.id = fl.freight_bill_id
             where fl.company_id = l.company_id and fl.lr_id = l.id
               and fl.bill_cancelled_at is null
             limit 1) as other_bill
      from lrs l where l.company_id = ${companyId} and l.id in ${uuidsIn(tx, ids)}`;
}

function lrLookup(rows: Row[]): (lrId: string) => LrForBill | undefined {
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  return (lrId) => {
    const r = byId.get(lrId);
    return r
      ? {
          lrNo: r.lr_no,
          live: !r.cancelled_at,
          booked: !!r.booked_at,
          otherBill: r.other_bill ?? null,
        }
      : undefined;
  };
}

const partyStateOf = (p: Row | undefined): string | null =>
  p ? (p.state_code ?? (p.gstin as string | null)?.slice(0, 2) ?? null) : null;

const billLineRows = (bill: Pick<FreightBill, "id" | "companyId" | "lines">) =>
  bill.lines.map((l, position) => ({
    id: l.id,
    company_id: bill.companyId,
    freight_bill_id: bill.id,
    lr_id: l.lrId,
    position,
    freight_paise: l.freightPaise,
    detention_paise: l.detentionPaise,
    other_paise: l.otherPaise,
    advance_paise: l.advancePaise,
    total_paise: l.totalPaise,
  }));

const billColumns = (b: FreightBill): Row => ({
  bill_date: b.billDate,
  party_id: b.partyId,
  gst_mode: b.gstMode,
  gst_rate_bp: b.gstRateBp,
  charges_paise: b.totals.chargesPaise,
  sgst_paise: b.totals.sgstPaise,
  cgst_paise: b.totals.cgstPaise,
  igst_paise: b.totals.igstPaise,
  advance_paise: b.totals.advancePaise,
  amount_paise: b.totals.amountPaise,
});

export async function insertFreightBill(
  companyId: string,
  v: ParsedBill,
): Promise<FreightBillView> {
  return withUser(async (tx) => {
    const [[company], [party], lrRows, problems] = await Promise.all([
      tx`select gstin, freight_gst_rate_bp from companies where id = ${companyId}`,
      tx`select * from parties where company_id = ${companyId} and id in ${uuidsIn(tx, [v.partyId])}`,
      lrsForBill(tx, companyId, v.lines.map((l) => l.lrId)),
      runChecks(tx, refCheck(tx, companyId, "parties", "partyId", "Party", v.partyId)),
    ]);
    assertNoProblems(problems);
    const lrFor = lrLookup(lrRows);
    assertBillableLrs(v.lines, lrFor);
    const gstRateBp =
      v.gstRateBp ?? (v.gstMode === "forward_charge" ? (company?.freight_gst_rate_bp ?? 0) : 0);
    const t = now();
    const bill: FreightBill = {
      id: newId(),
      companyId,
      createdAt: t,
      updatedAt: t,
      version: 1,
      createdBy: null,
      updatedBy: null,
      status: "draft",
      billNo: null,
      billDate: v.billDate,
      partyId: v.partyId,
      gstMode: v.gstMode,
      gstRateBp,
      ...priceBill(company.gstin, partyStateOf(party), v.gstMode, gstRateBp, v.lines),
      snapshot: null,
    };
    const [[saved]] = await checkedWrite<Row[][]>(
      null,
      [
        tx`insert into freight_bills ${tx({ id: bill.id, company_id: companyId, status: "draft", ...billColumns(bill) } as never)}
           returning *`,
        tx`insert into freight_bill_lines ${tx(billLineRows(bill) as never)}`,
      ],
      () => {},
    );
    const view = toBillView({
      ...saved,
      lines: bill.lines,
      party_name: party?.name,
      received_paise: 0,
      lr_nos: bill.lines.map((l) => lrFor(l.lrId)?.lrNo ?? ""),
    });
    audit(tx, companyId, "freight_bills", bill.id, "create", null, toFreightBill({ ...saved, lines: bill.lines }));
    return view;
  });
}

/** The bill locked for an edit, with its view columns, the company and its party. */
async function readBillForEdit(tx: Tx, companyId: string, id: string, newPartyId?: string) {
  if (!isUuid(id)) throw new NotFoundError("Freight bill");
  const [[cur], [company], parties] = await Promise.all([
    tx`select b.* ${billViewCols(tx)(tx`b`)} from freight_bills b
        where b.company_id = ${companyId} and b.id = ${id} for update of b`,
    tx`select * from companies where id = ${companyId}`,
    tx`select * from parties p where p.company_id = ${companyId}
          and (p.id in ${uuidsIn(tx, [newPartyId])}
               or p.id = (select party_id from freight_bills where company_id = ${companyId} and id = ${id}))`,
  ]);
  return { cur, company, parties: parties as Row[] };
}

function assertBillEditable(cur: Row | undefined, expectedVersion: number): asserts cur is Row {
  if (!cur) throw new NotFoundError("Freight bill");
  if (cur.cancelled_at) fail("", "This freight bill is cancelled and can't be changed");
  if (cur.version !== expectedVersion) throw new ConflictError();
}

export async function updateFreightBill(
  companyId: string,
  id: string,
  expectedVersion: number,
  p: ParsedBillPatch,
): Promise<FreightBillView> {
  return withUser(async (tx) => {
    const [{ cur, company, parties }, lrRows, problems] = await Promise.all([
      readBillForEdit(tx, companyId, id, p.partyId),
      p.lines ? lrsForBill(tx, companyId, p.lines.map((l) => l.lrId)) : Promise.resolve([] as Row[]),
      runChecks(tx, refCheck(tx, companyId, "parties", "partyId", "Party", p.partyId)),
    ]);
    assertNoProblems(problems);
    const lrFor = lrLookup(lrRows);
    if (p.lines) assertBillableLrs(p.lines, lrFor, id);
    assertBillEditable(cur, expectedVersion);
    const before = toFreightBill(cur);
    if (before.status === "final") fail("", BILL_FINAL);

    const next = { ...before, ...p, lines: before.lines };
    const party = parties.find((x) => x.id === next.partyId);
    const after: FreightBill = {
      ...next,
      ...priceBill(
        company.gstin,
        partyStateOf(party),
        next.gstMode,
        next.gstRateBp,
        p.lines ?? before.lines,
      ),
    };
    const linesChanged = JSON.stringify(after.lines) !== JSON.stringify(before.lines);
    const set = billColumns(after);
    if (linesChanged) set.lines_rev = tx`lines_rev + 1`;
    const lines = billLineRows(after);
    const [[updated]] = await checkedWrite<Row[][]>(
      null,
      [
        tx`update freight_bills set ${tx(set)}
            where company_id = ${companyId} and id = ${id} and version = ${expectedVersion}
        returning *`,
        ...(linesChanged
          ? [
              tx`delete from freight_bill_lines where company_id = ${companyId} and freight_bill_id = ${id}`,
              tx`insert into freight_bill_lines ${tx(lines as never)}`,
            ]
          : []),
      ],
      () => {},
    );
    if (!updated) throw new ConflictError();
    const oldNos = new Map(before.lines.map((l, i) => [l.lrId, (cur.lr_nos as string[])[i]]));
    const view = toBillView({
      ...updated,
      lines: after.lines,
      party_name: party?.name,
      received_paise: cur.received_paise,
      lr_nos: after.lines.map((l) => lrFor(l.lrId)?.lrNo ?? oldNos.get(l.lrId) ?? ""),
    });
    audit(tx, companyId, "freight_bills", id, "update", before, toFreightBill({ ...updated, lines: after.lines }));
    return view;
  });
}

export async function finaliseFreightBill(
  companyId: string,
  id: string,
  expectedVersion: number,
): Promise<FreightBillView> {
  return withUser(async (tx) => {
    const { cur, company, parties } = await readBillForEdit(tx, companyId, id);
    assertBillEditable(cur, expectedVersion);
    const before = toFreightBill(cur);
    if (before.status === "final") fail("", "Bill is already final");
    const party = parties.find((x) => x.id === before.partyId);
    if (!party) throw new NotFoundError("Party");
    const snapshot = {
      company: companySnapshot(toCompany(company, null)),
      party: partySnapshot(toParty(party)),
    };
    const fy = financialYear(before.billDate);
    // The number is taken in the same statement as the update; a failure gives it back.
    const [updated] = await tx`
      with nx as (select n.no from app.allocate_number(${companyId}, 'freight_bill', ${fy}) n)
      update freight_bills b
         set status = 'final', snapshot = ${tx.json(snapshot as never)}, bill_fy = ${fy},
             bill_seq = nx.no,
             bill_no = ${company.freight_bill_prefix}::text
                       || case when nx.no < 1000 then lpad(nx.no::text, 3, '0') else nx.no::text end
        from nx
       where b.company_id = ${companyId} and b.id = ${id} and b.version = ${expectedVersion}
   returning b.*`;
    if (!updated) throw new ConflictError();
    const row = { ...cur, ...updated };
    audit(tx, companyId, "freight_bills", id, "update", before, toFreightBill(row));
    return toBillView(row);
  });
}

export async function cancelFreightBill(companyId: string, id: string): Promise<FreightBillView> {
  return withUser(async (tx) => {
    if (!isUuid(id)) throw new NotFoundError("Freight bill");
    // Sent together: what was received, then the cancel (rolled back if anything was).
    const received = tx`select coalesce(sum(al.amount_paise), 0)::bigint as n
        from payment_allocations al
        join payments p on p.company_id = al.company_id and p.id = al.payment_id
       where al.company_id = ${companyId} and al.freight_bill_id = ${id}
         and p.cancelled_at is null`.execute();
    const cancelled = cancelRow(
      tx,
      "freight_bills",
      companyId,
      id,
      "Freight bill",
      undefined,
      billViewCols(tx),
    );
    const [r, c] = await Promise.allSettled([received, cancelled]);
    if (r.status === "rejected") throw r.reason;
    if ((r.value[0]?.n as number) > 0) fail("", BILL_HAS_PAYMENTS);
    if (c.status === "rejected") throw c.reason;
    const { before, after, changed } = c.value;
    if (changed) {
      audit(tx, companyId, "freight_bills", id, "cancel", toFreightBill(before), toFreightBill(after));
    }
    return toBillView(after);
  });
}

// ---------- payments ----------
const allocationsJson = (tx: Tx, a: Fragment) => tx`coalesce((select json_agg(json_build_object(
    'freightBillId', x.freight_bill_id, 'amountPaise', x.amount_paise) order by x.ctid)
  from payment_allocations x where x.company_id = ${a}.company_id and x.payment_id = ${a}.id), '[]')`;

const PAYMENT_SELECT = (tx: Tx) =>
  tx`select p.*, ${allocationsJson(tx, tx`p`)} as allocations from payments p`;

function paymentWhere(tx: Tx, companyId: string, params: PaymentListParams) {
  const q = contains(params.search);
  return tx`p.company_id = ${companyId} and p.cancelled_at is null
    ${
      params.partyId === undefined
        ? tx``
        : isUuid(params.partyId)
          ? tx`and p.party_id = ${params.partyId}`
          : tx`and false`
    }
    ${
      q
        ? tx`and (lower(coalesce(p.reference, '')) like ${q} or exists (
              select 1 from parties pa where pa.company_id = p.company_id and pa.id = p.party_id
                 and lower(pa.name) like ${q}))`
        : tx``
    }`;
}

export async function listPayments(
  companyId: string,
  params: PaymentListParams,
): Promise<Page<Payment>> {
  const { page, pageSize, offset } = paging(params);
  return withUserRead(async (tx) => {
    const [rows, [{ n }]] = await Promise.all([
      tx`${PAYMENT_SELECT(tx)} where ${paymentWhere(tx, companyId, params)}
          order by p.received_on desc, p.created_at desc, p.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n from payments p where ${paymentWhere(tx, companyId, params)}`,
    ]);
    return { rows: rows.map(toPayment), total: n as number, page, pageSize };
  });
}

export async function getPaymentById(companyId: string, id: string): Promise<Payment | null> {
  if (!isUuid(id)) return null;
  return withUserRead(async (tx) => {
    const [r] = await tx`${PAYMENT_SELECT(tx)} where p.company_id = ${companyId} and p.id = ${id}`;
    return r ? toPayment(r) : null;
  });
}

/** The allocated bills, locked, with what other live payments have settled on each. */
function billsForPayment(tx: Tx, companyId: string, v: ParsedPayment, paymentId: string | null) {
  return tx`
    select b.id, b.bill_no, b.status, b.cancelled_at, b.party_id, b.amount_paise,
           (select coalesce(sum(al.amount_paise), 0)::bigint
              from payment_allocations al
              join payments p on p.company_id = al.company_id and p.id = al.payment_id
             where al.company_id = b.company_id and al.freight_bill_id = b.id
               and p.cancelled_at is null
               ${paymentId ? tx`and p.id <> ${paymentId}` : tx``}) as received
      from freight_bills b
     where b.company_id = ${companyId}
       and b.id in ${uuidsIn(tx, (v.allocations ?? []).map((a) => a.freightBillId))}
       for update of b`;
}

function checkPaymentRows(v: ParsedPayment, bills: Row[]) {
  const byId = new Map(bills.map((b) => [b.id as string, b]));
  return checkAllocations(v, (id) => {
    const b = byId.get(id);
    return b
      ? {
          billNo: b.bill_no,
          live: !b.cancelled_at,
          final: b.status === "final",
          partyId: b.party_id,
          amountPaise: b.amount_paise,
          receivedPaise: b.received,
        }
      : undefined;
  });
}

const paymentColumns = (v: ParsedPayment): Row => ({
  party_id: v.partyId,
  amount_paise: v.amountPaise,
  tds_paise: v.tdsPaise ?? 0,
  mode: v.mode,
  received_on: v.receivedOn,
  reference: v.reference ?? null,
});

const allocationRows = (companyId: string, paymentId: string, list: Payment["allocations"]) =>
  list.map((a) => ({
    company_id: companyId,
    payment_id: paymentId,
    freight_bill_id: a.freightBillId,
    amount_paise: a.amountPaise,
  }));

export async function insertPayment(companyId: string, v: ParsedPayment): Promise<Payment> {
  return withUser(async (tx) => {
    const [problems, bills] = await Promise.all([
      runChecks(tx, refCheck(tx, companyId, "parties", "partyId", "Party", v.partyId)),
      billsForPayment(tx, companyId, v, null),
    ]);
    assertNoProblems(problems);
    const allocations = checkPaymentRows(v, bills);
    const id = newId();
    const allocs = allocationRows(companyId, id, allocations);
    const [[saved]] = await checkedWrite<Row[][]>(
      null,
      [
        tx`insert into payments ${tx({ id, company_id: companyId, ...paymentColumns(v) } as never)}
           returning *`,
        ...(allocs.length ? [tx`insert into payment_allocations ${tx(allocs as never)}`] : []),
      ],
      () => {},
    );
    const out = toPayment({ ...saved, allocations });
    audit(tx, companyId, "payments", id, "create", null, out);
    return out;
  });
}

export async function updatePayment(
  companyId: string,
  id: string,
  expectedVersion: number,
  v: ParsedPayment,
): Promise<Payment> {
  return withUser(async (tx) => {
    if (!isUuid(id)) throw new NotFoundError("Payment");
    const [[cur], problems, bills] = await Promise.all([
      tx`${PAYMENT_SELECT(tx)} where p.company_id = ${companyId} and p.id = ${id} for update of p`,
      runChecks(tx, refCheck(tx, companyId, "parties", "partyId", "Party", v.partyId)),
      billsForPayment(tx, companyId, v, id),
    ]);
    assertNoProblems(problems);
    const allocations = checkPaymentRows(v, bills);
    if (!cur) throw new NotFoundError("Payment");
    if (cur.cancelled_at) fail("", "This payment is cancelled and can't be changed");
    if (cur.version !== expectedVersion) throw new ConflictError();
    const before = toPayment(cur);
    const changed = JSON.stringify(before.allocations) !== JSON.stringify(allocations);
    const set = paymentColumns(v);
    if (changed) set.lines_rev = tx`lines_rev + 1`;
    const allocs = allocationRows(companyId, id, allocations);
    const [[updated]] = await checkedWrite<Row[][]>(
      null,
      [
        tx`update payments set ${tx(set)}
            where company_id = ${companyId} and id = ${id} and version = ${expectedVersion}
        returning *`,
        ...(changed
          ? [
              tx`delete from payment_allocations where company_id = ${companyId} and payment_id = ${id}`,
              ...(allocs.length ? [tx`insert into payment_allocations ${tx(allocs as never)}`] : []),
            ]
          : []),
      ],
      () => {},
    );
    if (!updated) throw new ConflictError();
    const out = toPayment({ ...updated, allocations });
    audit(tx, companyId, "payments", id, "update", before, out);
    return out;
  });
}

export async function cancelPayment(companyId: string, id: string): Promise<Payment> {
  return withUser(async (tx) => {
    if (!isUuid(id)) throw new NotFoundError("Payment");
    const { before, after, changed } = await cancelRow(
      tx,
      "payments",
      companyId,
      id,
      "Payment",
      undefined,
      (a) => tx`, ${allocationsJson(tx, a)} as allocations`,
    );
    if (changed) audit(tx, companyId, "payments", id, "cancel", toPayment(before), toPayment(after));
    return toPayment(after);
  });
}

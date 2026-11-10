// Truck payments on the database (TIER1-MARKET-TRUCKS.md §6 screen 4, T1-06 data layer).
// draft → pending_approval → approved (voucher number) → paid; reversed from approved / paid.
// Money rules and safeguards are the pure functions in lib/hire/payment.ts; this file loads what
// they need under row locks (payment, then its challans in id order) and writes one statement per
// change, with the audit row sent along with the commit. 0017_truck_payments.sql re-checks the
// status flow and the approval permission in a trigger.
import { financialYear } from "@/lib/fy";
import {
  calcTruckPayment,
  fromPaise,
  needsApproval,
  overpayIssues,
  paymentSafeguards,
  toPaise,
  type ChallanRoom,
  type PaymentIssue,
  type PaymentLine,
  type PaymentWarning,
} from "@/lib/hire";
import type { PayableChallan, TruckPayment } from "@/lib/types";
import type { TruckPaymentValues } from "@/lib/validators/truck-payment";
import { fail, newId } from "../_store";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { contains, withUser, withUserRead, type Tx } from "./conn";
import { audit, toTruckPayment, toTruckPaymentAllocation, type Row } from "./rows";
import { truckDocPathFromUrl } from "./storage";
import { saveRow, type Fragment } from "./write";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHAT = "Truck payment";

export type TruckPaymentResult = { payment: TruckPayment; warnings: PaymentWarning[] };

/** numeric (string) / null → paise. */
const p = (v: unknown): number => (v === null || v === undefined ? 0 : toPaise(String(v)));

type Line = { challanId: string; kind: "advance" | "balance"; grossPaise: number };

/** Where a payment's lines come from: the form (new draft) or its saved allocations. */
type Source =
  | { kind: "new"; payeeId: string; fy: string; lines: Line[]; branchId: string; pumpId: string | null }
  | { kind: "saved"; paymentId: string };

type Ctx = {
  /** Locked payment row (+ payee_name); saved source only. */
  payment: Row | null;
  allocations: Row[];
  /** Locked challans by id. */
  challans: Map<string, Row>;
  /** Charges and live allocations per challan, read after the locks. */
  sums: Map<string, Row>;
  /** Company settings + payee (+ branch_ok / pump_ok for a new draft). */
  info: Row;
  duplicates: string[];
};

const allocationsOf = (tx: Tx, companyId: string, paymentId: string) =>
  tx`select a.id, a.challan_id, c.challan_no, a.kind, a.amount, a.tds_amount
       from truck_payment_allocations a
       join challans c on c.company_id = a.company_id and c.id = a.challan_id
      where a.company_id = ${companyId} and a.payment_id = ${paymentId}
      order by c.challan_no, a.kind`;

const payeeName = (tx: Tx) => (alias: Fragment) =>
  tx`, (select tp.name from truck_parties tp
         where tp.company_id = ${alias}.company_id and tp.id = ${alias}.payee_party_id) as payee_name`;

/**
 * One pipelined round trip: lock the payment, lock its challans (id order), then read sums,
 * settings / payee and 24 h duplicates. Each statement takes its snapshot after the locks before
 * it, so the sums see every allocation committed by a payment that held a lock first.
 */
async function loadContext(tx: Tx, companyId: string, src: Source): Promise<Ctx> {
  const except = src.kind === "saved" ? src.paymentId : null;
  const lines = () =>
    src.kind === "new"
      ? tx`select x.challan_id, x.kind, x.gross
             from jsonb_to_recordset(${tx.json(
               src.lines.map((l) => ({
                 challan_id: l.challanId,
                 kind: l.kind,
                 gross: fromPaise(l.grossPaise),
               })) as never,
             )}::jsonb) as x(challan_id uuid, kind text, gross numeric)`
      : tx`select a.challan_id, a.kind::text as kind, a.amount + a.tds_amount as gross
             from truck_payment_allocations a
            where a.company_id = ${companyId} and a.payment_id = ${src.paymentId}`;
  const ids = () => tx`(select l.challan_id from (${lines()}) l)`;
  const payee = () =>
    src.kind === "new"
      ? tx`${src.payeeId}::uuid`
      : tx`(select payee_party_id from truck_payments where company_id = ${companyId} and id = ${src.paymentId})`;
  const fy = () =>
    src.kind === "new"
      ? tx`${src.fy}::text`
      : tx`(select payment_fy from truck_payments where company_id = ${companyId} and id = ${src.paymentId})`;

  const [payment, allocations, challans, sums, [info], dups] = await Promise.all([
    src.kind === "saved"
      ? tx`with cur as (select * from truck_payments
                         where company_id = ${companyId} and id = ${src.paymentId} for update)
           select cur.* ${payeeName(tx)(tx`cur`)} from cur`
      : Promise.resolve([] as Row[]),
    src.kind === "saved"
      ? allocationsOf(tx, companyId, src.paymentId)
      : Promise.resolve([] as Row[]),
    tx`with l as (select * from challans where company_id = ${companyId} and id in ${ids()}
                   order by id for update)
       select id, challan_no, payee_party_id, status, pod_received_at, cancelled_at, hire_amount from l`,
    tx`select c.id,
              coalesce(g.additions, 0) as additions, coalesce(g.deductions, 0) as deductions,
              coalesce(k.committed, 0) as committed, coalesce(k.tds_taken, 0) as tds_taken
         from challans c
         left join lateral (
           select sum(amount) filter (where direction = 'add') as additions,
                  sum(amount) filter (where direction = 'deduct') as deductions
             from challan_charges
            where company_id = c.company_id and challan_id = c.id and cancelled_at is null) g on true
         left join lateral (
           select sum(a.amount + a.tds_amount) as committed, sum(a.tds_amount) as tds_taken
             from truck_payment_allocations a
             join truck_payments tp on tp.company_id = a.company_id and tp.id = a.payment_id
            where a.company_id = c.company_id and a.challan_id = c.id
              and tp.cancelled_at is null and tp.status <> 'reversed'
              and tp.id is distinct from ${except}::uuid) k on true
        where c.company_id = ${companyId} and c.id in ${ids()}`,
    tx`select co.maker_checker_limit, co.cash_warning_limit, co.bank_change_cooling_hours,
              now() as db_now,
              tp.id as payee_id, tp.name as payee_name, tp.pan, tp.verified, tp.status as payee_status,
              tp.bank_changed_at, tp.account_no, tp.ifsc, tp.upi_id, tp.upi_qr_file,
              tp.cancelled_at as payee_cancelled_at,
              exists (select 1 from tds_declarations d
                       where d.company_id = co.id and d.party_id = tp.id and d.fy = ${fy()}
                         and d.cancelled_at is null) as declaration_on_file
              ${
                src.kind === "new"
                  ? tx`, exists (select 1 from branches b where b.company_id = co.id
                                   and b.id = ${src.branchId}::uuid and b.cancelled_at is null) as branch_ok,
                       (${src.pumpId}::uuid is null or exists (
                          select 1 from pumps u where u.company_id = co.id
                             and u.id = ${src.pumpId}::uuid and u.cancelled_at is null)) as pump_ok`
                  : tx``
              }
         from companies co
         left join truck_parties tp on tp.company_id = co.id and tp.id = ${payee()}
        where co.id = ${companyId}`,
    tx`select distinct coalesce(tp.payment_no,
                  'a draft of ' || to_char(tp.created_at at time zone 'Asia/Kolkata', 'DD-MM-YYYY HH24:MI')) as label
         from truck_payments tp
         join truck_payment_allocations a on a.company_id = tp.company_id and a.payment_id = tp.id
         join (${lines()}) x on x.challan_id = a.challan_id and x.gross = a.amount + a.tds_amount
        where tp.company_id = ${companyId} and tp.payee_party_id = ${payee()}
          and tp.cancelled_at is null and tp.status <> 'reversed'
          and tp.created_at > now() - interval '24 hours'
          and tp.id is distinct from ${except}::uuid`,
  ]);
  return {
    payment: payment[0] ?? null,
    allocations,
    challans: new Map(challans.map((r) => [r.id as string, r])),
    sums: new Map(sums.map((r) => [r.id as string, r])),
    info: info ?? {},
    duplicates: dups.map((r) => r.label as string),
  };
}

type EvalInput = {
  payeeId: string;
  mode: TruckPaymentValues["mode"];
  /** UPI ID / QR on the payment (warning only when missing). */
  hasUpiTarget: boolean;
  lines: PaymentLine[];
  tdsPaise: number;
  netPaise: number;
  canApprove: boolean;
  confirmDuplicate: boolean;
  podOverrideReason: string | null;
};

/** Challan / overpay checks, then the D5 safeguards. */
function evaluate(ctx: Ctx, e: EvalInput) {
  const issues: PaymentIssue[] = [];
  const { info } = ctx;
  if (!info.payee_id || info.payee_cancelled_at)
    issues.push({ path: "payeePartyId", message: "Payee not found in this company" });
  const rooms = new Map<string, ChallanRoom>();
  e.lines.forEach((l, i) => {
    const c = ctx.challans.get(l.challanId);
    const path = `allocations.${i}.challanId`;
    if (!c) return issues.push({ path, message: "Challan not found in this company" });
    if (c.cancelled_at) return issues.push({ path, message: `Challan ${c.challan_no} is cancelled` });
    if (c.payee_party_id !== e.payeeId)
      return issues.push({
        path,
        message: `Challan ${c.challan_no} is paid to someone else (see "Pay to" on the challan)`,
      });
    const s = ctx.sums.get(l.challanId);
    rooms.set(l.challanId, {
      challanNo: c.challan_no,
      payablePaise: p(c.hire_amount) + p(s?.additions) - p(s?.deductions),
      committedPaise: p(s?.committed),
      tdsTakenPaise: p(s?.tds_taken),
    });
  });
  issues.push(...overpayIssues(e.lines, rooms));
  if (issues.length) return { warnings: [] as PaymentWarning[], issues, needsApprover: false };

  const beforePod = [
    ...new Set(
      e.lines
        .filter((l) => l.kind === "balance")
        .map((l) => ctx.challans.get(l.challanId)!)
        .filter((c) => !c.pod_received_at)
        .map((c) => c.challan_no as string),
    ),
  ];
  const cool = info.bank_change_cooling_hours;
  const cash = info.cash_warning_limit;
  const s = paymentSafeguards({
    mode: e.mode,
    netPaise: e.netPaise,
    tdsPaise: e.tdsPaise,
    hasBalance: e.lines.some((l) => l.kind === "balance"),
    payee: {
      verified: !!info.verified,
      blacklisted: info.payee_status === "blacklisted",
      pan: (info.pan as string | null) ?? null,
      bankChangedAt: info.bank_changed_at ? new Date(info.bank_changed_at).toISOString() : null,
      hasBankDetails: !!(info.account_no && info.ifsc),
    },
    hasUpiTarget: e.hasUpiTarget,
    now: info.db_now ? new Date(info.db_now) : new Date(),
    coolingHours: cool === null || cool === undefined ? null : Number(cool),
    cashLimitPaise: cash === null || cash === undefined ? null : p(cash),
    declarationOnFile: !!info.declaration_on_file,
    balanceBeforePod: beforePod,
    podOverrideReason: e.podOverrideReason,
    duplicates: ctx.duplicates,
    confirmDuplicate: e.confirmDuplicate,
    canApprove: e.canApprove,
  });
  return { warnings: s.warnings, issues: s.blocks, needsApprover: s.needsApprover };
}

/** The saved allocations as calc lines (amounts are frozen at draft). */
const savedLines = (ctx: Ctx): PaymentLine[] =>
  ctx.allocations.map((a) => ({
    challanId: a.challan_id,
    kind: a.kind,
    grossPaise: p(a.amount) + p(a.tds_amount),
    tdsBasePaise: 0,
    tdsPaise: p(a.tds_amount),
    netPaise: p(a.amount),
  }));

function assertState(row: Row | null, expectedVersion: number | null, allowed: string[], msg: string): Row {
  if (!row) throw new NotFoundError(WHAT);
  if (row.cancelled_at) fail("", "This truck payment is cancelled and can't be changed");
  if (expectedVersion !== null && row.version !== expectedVersion) throw new ConflictError();
  if (!allowed.includes(row.status as string)) fail("", msg);
  return row;
}

/** What audit_log sees: no payee snapshot (it holds the full account number). */
function auditView(t: TruckPayment) {
  const { payeeSnapshot: _snapshot, ...rest } = t;
  void _snapshot;
  return rest;
}

const view = (r: Row, allocations: Row[]) =>
  toTruckPayment(r, allocations.map(toTruckPaymentAllocation));

/** draft / pending → approved: voucher number (branch + FY series, row-locked) and payee snapshot. */
async function approveRow(
  tx: Tx,
  companyId: string,
  cur: Row,
  warnings: PaymentWarning[],
  podOverrideReason: string | null,
): Promise<Row> {
  const [row] = await tx`
    with n as (select * from app.allocate_hire_number(${companyId}::uuid, 'truck_payment',
                                                       ${cur.branch_id}::uuid, ${cur.payment_fy}::text))
    update truck_payments t
       set status = 'approved', approved_by = auth.uid(), approved_at = now(),
           payment_no = app.format_hire_number(n.prefix, n.no, n.padding),
           payment_seq = n.no,
           warnings = ${tx.json(warnings as never)}::jsonb,
           pod_override_reason = ${podOverrideReason}::text,
           payee_snapshot = (
             select jsonb_build_object('name', tp.name, 'mobile', tp.mobile, 'pan', tp.pan,
                                       'gstin', tp.gstin, 'address', tp.address,
                                       'bankName', tp.bank_name, 'accountHolder', tp.account_holder,
                                       'accountNo', tp.account_no, 'ifsc', tp.ifsc, 'upiId', tp.upi_id)
               from truck_parties tp
              where tp.company_id = t.company_id and tp.id = t.payee_party_id)
      from n
     where t.company_id = ${companyId} and t.id = ${cur.id}
    returning t.* ${payeeName(tx)(tx`t`)}`;
  return row;
}

// ---------- writes ----------

/** New draft: allocations, TDS, overpay guard and safeguards checked; numbers come at approval. */
export async function insertTruckPayment(
  companyId: string,
  v: TruckPaymentValues,
  o: { canApprove: boolean },
): Promise<TruckPaymentResult> {
  const lines: Line[] = v.allocations.map((a) => ({
    challanId: a.challanId,
    kind: a.kind,
    grossPaise: toPaise(a.amount),
  }));
  const pumpId = v.mode === "diesel" ? v.pumpId : null;
  return withUser(async (tx) => {
    const ctx = await loadContext(tx, companyId, {
      kind: "new",
      payeeId: v.payeePartyId,
      fy: financialYear(v.paidOn),
      lines,
      branchId: v.branchId,
      pumpId,
    });
    const { info } = ctx;
    const calc = calcTruckPayment(
      v.tdsPercent,
      lines.map((l) => {
        const c = ctx.challans.get(l.challanId);
        const s = ctx.sums.get(l.challanId);
        return { ...l, tdsBasePaise: c ? p(c.hire_amount) + p(s?.additions) : 0 };
      }),
    );
    const issues: PaymentIssue[] = [...calc.issues];
    if (!info.branch_ok) issues.push({ path: "branchId", message: "Branch not found in this company" });
    if (pumpId && !info.pump_ok) issues.push({ path: "pumpId", message: "Pump not found in this company" });

    // UPI target: typed on the payment, else the payee's profile (UPI ID or uploaded QR).
    let upiId: string | null = null;
    let upiQrFile: string | null = null;
    if (v.mode === "upi") {
      upiId = v.upiId;
      upiQrFile = v.upiQrUrl ? truckDocPathFromUrl(companyId, v.upiQrUrl) : null;
      if (!upiId && !upiQrFile) {
        upiId = (info.upi_id as string | null) ?? null;
        upiQrFile = upiId ? null : ((info.upi_qr_file as string | null) ?? null);
      }
    }

    const checked = evaluate(ctx, {
      payeeId: v.payeePartyId,
      mode: v.mode,
      hasUpiTarget: !!(upiId || upiQrFile),
      lines: calc.lines,
      tdsPaise: calc.tdsPaise,
      netPaise: calc.netPaise,
      canApprove: o.canApprove,
      confirmDuplicate: v.confirmDuplicate,
      podOverrideReason: v.podOverrideReason,
    });
    issues.push(...checked.issues);
    if (issues.length) throw new ValidationError(issues);

    const id = newId();
    const row: Row = {
      id,
      company_id: companyId,
      branch_id: v.branchId,
      payment_fy: financialYear(v.paidOn),
      paid_on: v.paidOn,
      payee_party_id: v.payeePartyId,
      mode: v.mode,
      pump_id: pumpId,
      bank_account_id: v.bankAccountId,
      upi_id: upiId,
      upi_qr_file: upiQrFile,
      ref_no: v.refNo,
      cheque_date: v.mode === "cheque" ? v.chequeDate : null,
      amount: fromPaise(calc.netPaise),
      tds_amount: fromPaise(calc.tdsPaise),
      tds_percent: v.tdsPercent,
      narration: v.narration,
      status: "draft",
      warnings: tx.json(checked.warnings as never),
      pod_override_reason: v.podOverrideReason,
    };
    const allocs = calc.lines.map((l) => ({
      id: newId(),
      challan_id: l.challanId,
      challan_no: ctx.challans.get(l.challanId)!.challan_no as string,
      kind: l.kind,
      amount: fromPaise(l.netPaise),
      tds_amount: fromPaise(l.tdsPaise),
    }));
    const [saved] = await tx`
      with ins as (insert into truck_payments ${tx(row)} returning *),
           a as (insert into truck_payment_allocations (id, company_id, payment_id, challan_id, kind, amount, tds_amount)
                 select x.id, ins.company_id, ins.id, x.challan_id, x.kind::allocation_kind, x.amount, x.tds_amount
                   from ins, jsonb_to_recordset(${tx.json(allocs as never)}::jsonb)
                        as x(id uuid, challan_id uuid, kind text, amount numeric, tds_amount numeric)
                 returning 1)
      select ins.*, ${(info.payee_name as string | null) ?? null}::text as payee_name,
             (select count(*) from a)::int as n
        from ins`;
    const payment = view(saved, allocs);
    audit(tx, companyId, "truck_payments", id, "create", null, auditView(payment));
    return { payment, warnings: checked.warnings };
  });
}

/**
 * draft → approved when within the approval limit or the submitter has payment.approve (audited as
 * auto-approval); otherwise → pending_approval. Safeguards and the overpay guard run again.
 */
export async function submitTruckPayment(
  companyId: string,
  id: string,
  expectedVersion: number | null,
  o: { confirmDuplicate: boolean; podOverrideReason: string | null; canApprove: boolean },
): Promise<TruckPaymentResult> {
  if (!UUID.test(id)) throw new NotFoundError(WHAT);
  return withUser(async (tx) => {
    const ctx = await loadContext(tx, companyId, { kind: "saved", paymentId: id });
    const cur = assertState(ctx.payment, expectedVersion, ["draft"], "Only a draft payment can be submitted");
    const reason = o.podOverrideReason ?? (cur.pod_override_reason as string | null) ?? null;
    const confirmed = ((cur.warnings as PaymentWarning[] | null) ?? []).some((w) => w.code === "duplicate");
    const checked = evaluate(ctx, {
      payeeId: cur.payee_party_id,
      mode: cur.mode,
      hasUpiTarget: !!(cur.upi_id || cur.upi_qr_file),
      lines: savedLines(ctx),
      tdsPaise: p(cur.tds_amount),
      netPaise: p(cur.amount),
      canApprove: o.canApprove,
      confirmDuplicate: o.confirmDuplicate || confirmed,
      podOverrideReason: reason,
    });
    if (checked.issues.length) throw new ValidationError(checked.issues);

    const limit = ctx.info.maker_checker_limit;
    const overLimit = needsApproval(
      p(cur.amount) + p(cur.tds_amount),
      limit === null || limit === undefined ? null : p(limit),
    );
    const needsApprover = overLimit || checked.needsApprover;
    const auto = !needsApprover
      ? "Auto-approved: within the approval limit"
      : o.canApprove
        ? "Auto-approved: submitted by a user who can approve payments"
        : null;
    let after: Row;
    if (auto) after = await approveRow(tx, companyId, cur, checked.warnings, reason);
    else
      [after] = await tx`
        update truck_payments t
           set status = 'pending_approval', warnings = ${tx.json(checked.warnings as never)}::jsonb,
               pod_override_reason = ${reason}::text
         where t.company_id = ${companyId} and t.id = ${id}
        returning t.* ${payeeName(tx)(tx`t`)}`;
    const before = view(cur, ctx.allocations);
    const payment = view(after, ctx.allocations);
    audit(tx, companyId, "truck_payments", id, "update", auditView(before), {
      ...auditView(payment),
      ...(auto ? { approval: auto } : {}),
    });
    return { payment, warnings: checked.warnings };
  });
}

/** pending_approval → approved by a payment.approve user (blacklist / overpay re-checked). */
export async function approveTruckPayment(
  companyId: string,
  id: string,
  expectedVersion: number | null,
  podOverrideReason: string | null,
): Promise<TruckPaymentResult> {
  if (!UUID.test(id)) throw new NotFoundError(WHAT);
  return withUser(async (tx) => {
    const ctx = await loadContext(tx, companyId, { kind: "saved", paymentId: id });
    const cur = assertState(
      ctx.payment,
      expectedVersion,
      ["pending_approval"],
      "Only a payment waiting for approval can be approved",
    );
    const reason = podOverrideReason ?? (cur.pod_override_reason as string | null) ?? null;
    const checked = evaluate(ctx, {
      payeeId: cur.payee_party_id,
      mode: cur.mode,
      hasUpiTarget: !!(cur.upi_id || cur.upi_qr_file),
      lines: savedLines(ctx),
      tdsPaise: p(cur.tds_amount),
      netPaise: p(cur.amount),
      canApprove: true,
      confirmDuplicate: true,
      podOverrideReason: reason,
    });
    if (checked.issues.length) throw new ValidationError(checked.issues);
    const after = await approveRow(tx, companyId, cur, checked.warnings, reason);
    const payment = view(after, ctx.allocations);
    audit(tx, companyId, "truck_payments", id, "update", auditView(view(cur, ctx.allocations)), auditView(payment));
    return { payment, warnings: checked.warnings };
  });
}

/** approved → paid with the paid date and UTR (required for bank / UPI). One statement. */
export async function markTruckPaymentPaid(
  companyId: string,
  id: string,
  expectedVersion: number | null,
  v: { paidOn: string; refNo: string | null },
): Promise<TruckPayment> {
  if (!UUID.test(id)) throw new NotFoundError(WHAT);
  return withUser(async (tx) => {
    const set: Row = {
      status: "paid",
      paid_on: v.paidOn,
      paid_at: tx`now()`,
      paid_by: tx`auth.uid()`,
    };
    if (v.refNo) set.ref_no = v.refNo;
    const [{ before, after }, allocations] = await Promise.all([
      saveRow(tx, "truck_payments", companyId, id, expectedVersion, set, {
        what: WHAT,
        guard: tx`cur.status = 'approved' and (cur.mode not in ('bank', 'upi') or ${v.refNo}::text is not null)`,
        validate: (b) => {
          if (b.status !== "approved")
            fail("", b.status === "paid" ? "This payment is already marked paid" : "Only an approved payment can be marked paid");
          if ((b.mode === "bank" || b.mode === "upi") && !v.refNo)
            fail("refNo", "Enter the UTR / transaction reference");
        },
        extra: payeeName(tx),
      }),
      allocationsOf(tx, companyId, id),
    ]);
    const payment = view(after, allocations);
    audit(tx, companyId, "truck_payments", id, "update", auditView(view(before, allocations)), auditView(payment));
    return payment;
  });
}

/** approved / paid → reversed with a reason; the allocations stop counting everywhere. */
export async function reverseTruckPayment(
  companyId: string,
  id: string,
  expectedVersion: number | null,
  reason: string,
): Promise<TruckPayment> {
  if (!UUID.test(id)) throw new NotFoundError(WHAT);
  return withUser(async (tx) => {
    const [{ before, after }, allocations] = await Promise.all([
      saveRow(
        tx,
        "truck_payments",
        companyId,
        id,
        expectedVersion,
        {
          status: "reversed",
          reversed_at: tx`now()`,
          reversed_by: tx`auth.uid()`,
          reversal_reason: reason,
        },
        {
          what: WHAT,
          guard: tx`cur.status in ('approved', 'paid')`,
          validate: (b) => {
            if (b.status === "reversed") fail("", "This payment is already reversed");
            if (b.status !== "approved" && b.status !== "paid")
              fail("", "Only an approved or paid payment can be reversed");
          },
          extra: payeeName(tx),
        },
      ),
      allocationsOf(tx, companyId, id),
    ]);
    const payment = view(after, allocations);
    audit(tx, companyId, "truck_payments", id, "update", auditView(view(before, allocations)), auditView(payment));
    return payment;
  });
}

// ---------- reads ----------

export async function getTruckPayment(companyId: string, id: string): Promise<TruckPayment | null> {
  if (!UUID.test(id)) return null;
  return withUserRead(async (tx) => {
    const [[r], allocations] = await Promise.all([
      tx`select t.* ${payeeName(tx)(tx`t`)} from truck_payments t
          where t.company_id = ${companyId} and t.id = ${id}`,
      allocationsOf(tx, companyId, id),
    ]);
    return r ? view(r, allocations) : null;
  });
}

/** The payee's live challans that can still take a payment (pay-truck picker), oldest first. */
export async function listPayableChallans(
  companyId: string,
  payeeId: string,
): Promise<PayableChallan[]> {
  if (!UUID.test(payeeId)) return [];
  return withUserRead(async (tx) => {
    const rows = await tx`
      select c.id, c.challan_no, (c.challan_at at time zone 'Asia/Kolkata')::date::text as challan_date,
             c.status, c.source, c.destination, v.vehicle_no, (c.pod_received_at is not null) as pod_received,
             vb.gross_credit, vb.deductions, vb.paid, vb.balance,
             coalesce(k.committed, 0) as committed, coalesce(k.tds_taken, 0) as tds_taken
        from challans c
        join v_challan_balance vb on vb.company_id = c.company_id and vb.challan_id = c.id
        left join market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
        left join lateral (
          select sum(a.amount + a.tds_amount) as committed, sum(a.tds_amount) as tds_taken
            from truck_payment_allocations a
            join truck_payments tp on tp.company_id = a.company_id and tp.id = a.payment_id
           where a.company_id = c.company_id and a.challan_id = c.id
             and tp.cancelled_at is null and tp.status <> 'reversed') k on true
       where c.company_id = ${companyId} and c.payee_party_id = ${payeeId} and c.cancelled_at is null
         and vb.gross_credit - vb.deductions - coalesce(k.committed, 0) > 0
       order by c.challan_at, c.id
       limit 200`;
    return rows.map((r): PayableChallan => {
      const payable = p(r.gross_credit) - p(r.deductions);
      const committed = p(r.committed);
      return {
        challanId: r.id,
        challanNo: r.challan_no,
        challanDate: r.challan_date,
        status: r.status,
        source: r.source ?? null,
        destination: r.destination ?? null,
        vehicleNo: r.vehicle_no ?? null,
        podReceived: !!r.pod_received,
        tdsBasePaise: p(r.gross_credit),
        payablePaise: payable,
        paidPaise: p(r.paid),
        balancePaise: p(r.balance),
        committedPaise: committed,
        roomPaise: payable - committed,
        tdsTaken: p(r.tds_taken) > 0,
      };
    });
  });
}

// ---------- lists (payments screen, challan page) ----------

/** One line of the payments list / a challan's payments. Rupees as numeric strings. */
export type TruckPaymentRow = {
  id: string;
  version: number;
  paymentNo: string | null;
  paidOn: string;
  payeeName: string | null;
  challanNos: string[];
  amount: string;
  tdsAmount: string;
  grossAmount: string;
  mode: TruckPayment["mode"];
  status: TruckPayment["status"];
  refNo: string | null;
};

const toRow = (r: Row): TruckPaymentRow => ({
  id: r.id,
  version: Number(r.version),
  paymentNo: r.payment_no ?? null,
  paidOn: r.paid_on,
  payeeName: r.payee_name ?? null,
  challanNos: (r.challan_nos as string[] | null) ?? [],
  amount: String(r.amount),
  tdsAmount: String(r.tds_amount),
  grossAmount: fromPaise(p(r.amount) + p(r.tds_amount)),
  mode: r.mode,
  status: r.status,
  refNo: r.ref_no ?? null,
});

const ROW_SELECT = (tx: Tx) => tx`
  t.id, t.version, t.payment_no, t.paid_on::text as paid_on, t.mode::text as mode, t.status::text as status,
  t.ref_no, t.amount, t.tds_amount, tp.name as payee_name, ch.nos as challan_nos`;
const ROW_JOINS = (tx: Tx) => tx`
  left join truck_parties tp on tp.company_id = t.company_id and tp.id = t.payee_party_id
  left join lateral (
    select array_agg(c.challan_no order by c.challan_no) as nos
      from truck_payment_allocations a
      join challans c on c.company_id = a.company_id and c.id = a.challan_id
     where a.company_id = t.company_id and a.payment_id = t.id) ch on true`;

export async function listTruckPaymentRows(
  companyId: string,
  f: {
    from?: string;
    to?: string;
    status?: string;
    payee?: string;
    mode?: string;
    page: number;
    pageSize: number;
  },
): Promise<{ rows: TruckPaymentRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(f.pageSize, 1), 50);
  const page = Math.max(f.page, 1);
  const like = contains(f.payee);
  return withUserRead(async (tx) => {
    const where = tx`t.company_id = ${companyId} and t.cancelled_at is null
      ${f.from ? tx`and t.paid_on >= ${f.from}::date` : tx``}
      ${f.to ? tx`and t.paid_on <= ${f.to}::date` : tx``}
      ${f.status ? tx`and t.status::text = ${f.status}` : tx``}
      ${f.mode ? tx`and t.mode::text = ${f.mode}` : tx``}
      ${like ? tx`and lower(tp.name) like ${like}` : tx``}`;
    const [rows, [{ n }]] = await Promise.all([
      tx`select ${ROW_SELECT(tx)} from truck_payments t ${ROW_JOINS(tx)}
          where ${where} order by t.paid_on desc, t.created_at desc, t.id
          limit ${pageSize} offset ${(page - 1) * pageSize}`,
      tx`select count(*)::int as n from truck_payments t
          left join truck_parties tp on tp.company_id = t.company_id and tp.id = t.payee_party_id
          where ${where}`,
    ]);
    return { rows: rows.map(toRow), total: n as number, page, pageSize };
  });
}

/** Live and past payments that settle part of one challan (challan page, newest first). */
export async function listPaymentsForChallan(
  companyId: string,
  challanId: string,
): Promise<TruckPaymentRow[]> {
  if (!UUID.test(challanId)) return [];
  return withUserRead(async (tx) => {
    const rows = await tx`select ${ROW_SELECT(tx)} from truck_payments t ${ROW_JOINS(tx)}
        where t.company_id = ${companyId} and t.cancelled_at is null
          and exists (select 1 from truck_payment_allocations a
                       where a.company_id = t.company_id and a.payment_id = t.id and a.challan_id = ${challanId})
        order by t.paid_on desc, t.created_at desc limit 50`;
    return rows.map(toRow);
  });
}

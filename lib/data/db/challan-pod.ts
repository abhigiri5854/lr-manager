// POD settlement on the database (TIER1-MARKET-TRUCKS.md §6 screen 3, T1-07). Data layer only.
//
// Owner decision: payments are OPTIONAL. Nothing here reads or requires truck payments; a challan
// settles on its POD alone (paid / balance are shown from v_challan_balance, nothing more).
//
// Challan ↔ LR POD sync. The challan holds the trip facts: reported / unloaded / POD-received dates
// and delivered packages per LR line (challan_lrs). The LR's POD keeps its single home (pods +
// lrs.delivered_at via app.set_lr_delivered), written through db/pod.ts createPodIn / updatePodIn in
// the SAME transaction:
//   LR delivered on   = the challan's unloading date (India)
//   POD received at   = the challan's POD received date
//   packages received = Σ delivered on the LR's live challan lines (split LRs add up)
//   POD files         = the LR POD's document_paths (uploaded per LR with uploadPodFile)
// The sync runs challan → LR. Editing the LR's own POD screen doesn't write back to the challan.
//
// Statuses: dispatched → pod_received (POD date set) → settled. Settled locks the POD fields, delivered
// packages and POD charges (also enforced by triggers, 0020_pod_settlement.sql); reopening needs
// record.cancel + a reason.
import {
  appliedAutoPaise,
  fromPaise,
  latePodAutoPaise,
  latePodRule,
  lineShortage,
  podDateIssues,
  SETTLED_LOCKED,
  settleProblem,
  settlementMoney,
  statusAfterPod,
  toPaise,
  type HireCharge,
  type PodDates,
} from "@/lib/hire";
import type {
  ChallanPodCharge,
  ChallanPodLine,
  ChallanSettlement,
  ChallanSettlementState,
  Pod,
  Role,
  UnbilledChallanCharge,
} from "@/lib/types";
import type { ChallanPodChargesValues, ChallanPodValues } from "@/lib/validators/challan-pod";
import { can } from "@/lib/permissions";
import { podFields } from "@/lib/validators/pod";
import { fail, newId, parseInput } from "../_store";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { withCommit, withUser, withUserRead, type Tx } from "./conn";
import { createPodIn, updatePodIn } from "./pod";
import { audit, type Row } from "./rows";
import { podUrlFromPath } from "./storage";
import { saveRow, uuidsIn, type Fragment } from "./write";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const podPatchFields = podFields.omit({ lrId: true }).partial();

const isoOrNull = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** The India calendar date of an instant. */
const indiaDate = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);

type Issue = { path: string; message: string };

// ---------- reading ----------
type Loaded = { c: Row; lines: Row[]; charges: Row[]; co: Row; bal: Row | undefined };

/** The challan (locked for writes), its LR lines with their LR POD, its POD-stage charges, the rules. */
async function load(tx: Tx, companyId: string, id: string, lock: boolean): Promise<Loaded | null> {
  const [[c], lines, charges, [co], [bal]] = await Promise.all([
    tx`select c.*, v.vehicle_no, pp.name as payee_name
         from challans c
         left join market_vehicles v on v.company_id = c.company_id and v.id = c.vehicle_id
         left join truck_parties pp on pp.company_id = c.company_id and pp.id = c.payee_party_id
        where c.company_id = ${companyId} and c.id = ${id}
        ${lock ? tx`for update of c` : tx``}`,
    tx`select cl.lr_id, cl.loaded_pkgs, cl.delivered_pkgs, cl.freight_allocated, l.lr_no, l.lr_date,
              p.id as pod_id, p.version as pod_version, p.document_paths as pod_paths,
              p.condition as pod_condition, p.remarks as pod_remarks,
              (select coalesce(sum(o.delivered_pkgs), 0)::int
                 from challan_lrs o
                 join challans oc on oc.company_id = o.company_id and oc.id = o.challan_id
                where o.company_id = cl.company_id and o.lr_id = cl.lr_id
                  and o.challan_id <> cl.challan_id and oc.cancelled_at is null
                  and o.transferred_to_challan_id is null) as other_delivered
         from challan_lrs cl
         join lrs l on l.company_id = cl.company_id and l.id = cl.lr_id
         left join pods p on p.company_id = cl.company_id and p.lr_id = cl.lr_id and p.cancelled_at is null
        where cl.company_id = ${companyId} and cl.challan_id = ${id}
          and cl.transferred_to_challan_id is null
        order by cl.created_at, cl.id`,
    tx`select g.*, t.label, t.code, l.lr_no, b.bill_no,
              (b.id is not null and b.cancelled_at is null) as billed_live
         from challan_charges g
         left join charge_types t on t.company_id = g.company_id and t.id = g.charge_type_id
         left join lrs l on l.company_id = g.company_id and l.id = g.lr_id
         left join freight_bills b on b.company_id = g.company_id and b.id = g.billed_in_freight_bill_id
        where g.company_id = ${companyId} and g.challan_id = ${id}
          and g.stage = 'pod' and g.cancelled_at is null
        order by g.auto_kind nulls last, g.created_at, g.id`,
    tx`select late_pod_days, late_pod_fee, shortage_auto, shortage_allowance_pct, shortage_rate_source
         from companies where id = ${companyId}`,
    tx`select hire_amount, additions, deductions, tds_amount, paid
         from v_challan_balance where company_id = ${companyId} and challan_id = ${id}`,
  ]);
  return c ? { c, lines, charges, co, bal } : null;
}

function toCharge(g: Row): ChallanPodCharge {
  return {
    id: g.id,
    version: g.version,
    chargeTypeId: g.charge_type_id ?? null,
    label: g.label ?? null,
    autoKind: g.auto_kind ?? null,
    lrId: g.lr_id ?? null,
    lrNo: g.lr_no ?? null,
    direction: g.direction,
    amount: String(g.amount),
    autoAmount: str(g.auto_amount),
    overrideReason: g.override_reason ?? null,
    billParty: !!g.bill_party,
    partyAmount: str(g.party_amount),
    billedInFreightBillId: g.billed_in_freight_bill_id ?? null,
    billedBillNo: g.billed_live ? (g.bill_no ?? null) : null,
    billed: !!g.billed_live,
    note: g.note ?? null,
  };
}

function toLine(l: Row, delivered: number | null, pod: Pod | undefined): ChallanPodLine {
  const paths = (l.pod_paths as string[] | null) ?? [];
  return {
    lrId: l.lr_id,
    lrNo: l.lr_no,
    loadedPkgs: l.loaded_pkgs,
    deliveredPkgs: delivered,
    freightAllocated: String(l.freight_allocated),
    podId: pod?.id ?? l.pod_id ?? null,
    podVersion: pod?.version ?? l.pod_version ?? null,
    podDocumentUrls: pod ? pod.documentUrls : paths.map(podUrlFromPath),
  };
}

const asCharges = (rows: Row[]): HireCharge[] =>
  rows.map((g) => ({ direction: g.direction, amount: String(g.amount) }));

function toState(c: Row): ChallanSettlementState {
  return {
    id: c.id,
    version: c.version,
    status: c.status,
    settledAt: isoOrNull(c.settled_at),
    reopenedAt: isoOrNull(c.reopened_at),
    reopenReason: c.reopen_reason ?? null,
  };
}

/** The screen's record from a challan row + lines + POD charges (before = charges v_challan_balance saw). */
function build(
  s: Loaded,
  c: Row,
  lines: ChallanPodLine[],
  charges: Row[],
): ChallanSettlement {
  const b = s.bal;
  return {
    ...toState(c),
    challanNo: c.challan_no,
    vehicleNo: s.c.vehicle_no ?? null,
    payeeName: s.c.payee_name ?? null,
    reportedAt: isoOrNull(c.reported_at),
    unloadedAt: isoOrNull(c.unloaded_at),
    podReceivedAt: isoOrNull(c.pod_received_at),
    lines,
    charges: charges.map(toCharge),
    rules: {
      latePodDays: (c.late_pod_days ?? s.co.late_pod_days ?? null) as number | null,
      latePodFee: str(c.late_pod_fee ?? s.co.late_pod_fee),
      shortageAuto: !!s.co.shortage_auto,
      shortageAllowancePct: str(s.co.shortage_allowance_pct),
      shortageRateSource: s.co.shortage_rate_source ?? null,
    },
    money: settlementMoney(
      {
        hireAmount: String(b?.hire_amount ?? c.hire_amount),
        additions: String(b?.additions ?? 0),
        deductions: String(b?.deductions ?? 0),
        tds: String(b?.tds_amount ?? 0),
        paid: String(b?.paid ?? 0),
      },
      asCharges(s.charges),
      asCharges(charges),
    ),
  };
}

/** Audit view of the challan's POD facts. */
const podAuditView = (c: Row, delivered: Map<string, number | null>) => ({
  status: c.status,
  reportedAt: isoOrNull(c.reported_at),
  unloadedAt: isoOrNull(c.unloaded_at),
  podReceivedAt: isoOrNull(c.pod_received_at),
  delivered: Object.fromEntries(delivered),
});

function assertOpen(c: Row, expectedVersion: number | null) {
  if (c.cancelled_at) fail("", "This challan is cancelled");
  if (expectedVersion !== null && c.version !== expectedVersion) throw new ConflictError();
  if (c.status === "draft") fail("", "Dispatch the challan before recording its POD");
  if (c.status === "settled") fail("", SETTLED_LOCKED);
}

export async function getChallanSettlement(
  companyId: string,
  id: string,
): Promise<ChallanSettlement | null> {
  if (!UUID.test(id)) return null;
  return withUserRead(async (tx) => {
    const s = await load(tx, companyId, id, false);
    if (!s) return null;
    return build(
      s,
      s.c,
      s.lines.map((l) => toLine(l, l.delivered_pkgs ?? null, undefined)),
      s.charges,
    );
  });
}

// ---------- system lines (late-POD fee, shortage) ----------
type Auto = { kind: "late_pod" | "shortage"; lrId: string | null; paise: number };

/** The late-POD fee and per-LR shortage from the rules in force, these dates and delivered packages. */
function computeAutos(s: Loaded, dates: PodDates, delivered: Map<string, number | null>): Auto[] {
  const { c } = s;
  const rule = latePodRule(
    { allowedDays: s.co.late_pod_days, fee: str(s.co.late_pod_fee) },
    { allowedDays: c.late_pod_days, fee: str(c.late_pod_fee) },
  );
  const shortage = {
    enabled: !!s.co.shortage_auto,
    allowancePct: str(s.co.shortage_allowance_pct),
    rateSource: s.co.shortage_rate_source as string | null,
  };
  const totalLoadedPkgs = s.lines.reduce((t, l) => t + (l.loaded_pkgs as number), 0);
  return [
    {
      kind: "late_pod",
      lrId: null,
      paise: latePodAutoPaise(dates.unloadedAt, dates.podReceivedAt, rule),
    },
    ...s.lines.map(
      (l): Auto => ({
        kind: "shortage",
        lrId: l.lr_id,
        paise: lineShortage(
          {
            loadedPkgs: l.loaded_pkgs,
            deliveredPkgs: delivered.get(l.lr_id) ?? null,
            freightAllocated: String(l.freight_allocated),
          },
          shortage,
          { hireAmount: String(c.hire_amount), totalLoadedPkgs },
        ).amountPaise,
      }),
    ),
  ];
}

/** Updates / inserts that bring the system lines to the computed amounts (overrides keep their amount). */
function planAutoLines(charges: Row[], autos: Auto[]) {
  const byKey = new Map(
    charges.filter((g) => g.auto_kind).map((g) => [`${g.auto_kind}|${g.lr_id ?? ""}`, g]),
  );
  const after = new Map(charges.map((g) => [g.id as string, g]));
  const updates: { before: Row; row: Row }[] = [];
  const inserts: Row[] = [];
  for (const a of autos) {
    const g = byKey.get(`${a.kind}|${a.lrId ?? ""}`);
    const auto = fromPaise(a.paise);
    if (g) {
      const amount = g.override_reason ? String(g.amount) : auto;
      if (toPaise(String(g.auto_amount)) === a.paise && toPaise(String(g.amount)) === toPaise(amount))
        continue;
      const row = { ...g, auto_amount: auto, amount };
      updates.push({ before: g, row });
      after.set(g.id, row);
    } else if (a.paise > 0) {
      const row: Row = {
        id: newId(),
        version: 1,
        charge_type_id: null,
        label: null,
        auto_kind: a.kind,
        lr_id: a.lrId,
        lr_no: null,
        direction: "deduct",
        amount: auto,
        auto_amount: auto,
        override_reason: null,
        bill_party: false,
        party_amount: null,
        billed_in_freight_bill_id: null,
        billed_live: false,
        note: null,
      };
      inserts.push(row);
      after.set(row.id, row);
    }
  }
  return { updates, inserts, after: [...after.values()] };
}

function writeAutoLines(
  tx: Tx,
  companyId: string,
  challanId: string,
  plan: ReturnType<typeof planAutoLines>,
) {
  if (plan.updates.length) {
    const rows = plan.updates.map(({ row }) => ({
      id: row.id,
      auto_amount: row.auto_amount,
      amount: row.amount,
    }));
    withCommit(
      tx,
      tx`update challan_charges g set auto_amount = x.auto_amount, amount = x.amount
           from jsonb_to_recordset(${tx.json(rows as never)}::jsonb)
                as x(id uuid, auto_amount numeric, amount numeric)
          where g.company_id = ${companyId} and g.challan_id = ${challanId} and g.id = x.id
            and g.auto_kind is not null`,
    );
  }
  if (plan.inserts.length) {
    const rows = plan.inserts.map((r) => ({
      id: r.id,
      lr_id: r.lr_id,
      auto_kind: r.auto_kind,
      amount: r.amount,
    }));
    withCommit(
      tx,
      tx`insert into challan_charges (id, company_id, challan_id, lr_id, stage, direction, amount,
                                      auto_kind, auto_amount)
         select x.id, ${companyId}::uuid, ${challanId}::uuid, x.lr_id, 'pod', 'deduct', x.amount,
                x.auto_kind::pod_auto_kind, x.amount
           from jsonb_to_recordset(${tx.json(rows as never)}::jsonb)
                as x(id uuid, lr_id uuid, auto_kind text, amount numeric)`,
    );
  }
  for (const { before, row } of plan.updates)
    audit(tx, companyId, "challan_charges", row.id, "update", toCharge(before), toCharge(row));
  for (const row of plan.inserts)
    audit(tx, companyId, "challan_charges", row.id, "create", null, toCharge(row));
}

// ---------- writes ----------
/**
 * Records the trip's POD on the challan: reported / unloaded / POD-received dates, delivered packages
 * per LR and POD files, and the LR PODs that go with them (see the header). Recomputes the late-POD
 * fee and (when the company enables it) shortage. One transaction.
 */
export async function recordChallanPod(
  companyId: string,
  id: string,
  expectedVersion: number,
  v: ChallanPodValues,
  role: Role,
): Promise<ChallanSettlement> {
  if (!UUID.test(id)) throw new NotFoundError("Challan");
  return withUser((tx) => recordChallanPodIn(tx, companyId, id, expectedVersion, v, role, true));
}

/**
 * recordChallanPod inside the caller's transaction. expectedVersion null = the locked current version
 * (the LR POD → challan sync). lrPods false = don't write the LR PODs (the caller just wrote it).
 */
async function recordChallanPodIn(
  tx: Tx,
  companyId: string,
  id: string,
  expectedVersion: number | null,
  v: ChallanPodValues,
  role: Role,
  lrPods: boolean,
): Promise<ChallanSettlement> {
  {
    const s = await load(tx, companyId, id, true);
    if (!s) throw new NotFoundError("Challan");
    const { c } = s;
    assertOpen(c, expectedVersion);
    const version = expectedVersion ?? (c.version as number);

    const pick = (given: string | null | undefined, cur: unknown) =>
      given === undefined ? isoOrNull(cur) : given;
    const dates: PodDates = {
      reportedAt: pick(v.reportedAt, c.reported_at),
      unloadedAt: pick(v.unloadedAt, c.unloaded_at),
      podReceivedAt: pick(v.podReceivedAt, c.pod_received_at),
    };
    const issues: Issue[] = [...podDateIssues(dates)];
    const byLr = new Map(s.lines.map((l) => [l.lr_id as string, l]));
    const delivered = new Map(
      s.lines.map((l) => [l.lr_id as string, (l.delivered_pkgs as number | null) ?? null]),
    );
    const given = new Map<string, ChallanPodValues["lrs"][number]>();
    v.lrs.forEach((x, i) => {
      const l = byLr.get(x.lrId);
      if (!l) return void issues.push({ path: `lrs.${i}.lrId`, message: "This LR isn't on the challan" });
      if (given.has(x.lrId))
        return void issues.push({ path: `lrs.${i}.lrId`, message: `LR ${l.lr_no} is listed twice` });
      given.set(x.lrId, x);
      if (x.deliveredPkgs !== undefined) {
        if (x.deliveredPkgs !== null && x.deliveredPkgs > l.loaded_pkgs)
          issues.push({
            path: `lrs.${i}.deliveredPkgs`,
            message: `LR ${l.lr_no}: only ${l.loaded_pkgs} packages were loaded`,
          });
        delivered.set(x.lrId, x.deliveredPkgs);
      }
    });
    if (v.lrs.some((x) => x.documentUrls?.length) && !dates.podReceivedAt)
      issues.push({ path: "podReceivedAt", message: "Enter the POD received date for the POD files" });
    if (
      !dates.podReceivedAt &&
      c.pod_received_at &&
      s.lines.some((l) => ((l.pod_paths as string[] | null) ?? []).length)
    )
      issues.push({
        path: "podReceivedAt",
        message: "The LR PODs have files — remove them before clearing the POD received date",
      });
    if (!dates.unloadedAt && s.lines.some((l) => l.pod_id))
      issues.push({
        path: "unloadedAt",
        message: "These LRs have a POD — cancel it on the LR's POD screen before clearing the unloading date",
      });
    // Same rule as the driver POD (app.driver_pod_attach): delivery (unloading) date not before the LR date.
    // Only the challan POD screen (lrPods): the LR POD → challan sync keeps the LR POD screen's own rule.
    if (lrPods && dates.unloadedAt && dates.unloadedAt !== isoOrNull(c.unloaded_at)) {
      const deliveredOn = indiaDate(dates.unloadedAt);
      const earliest = s.lines
        .map((l) => str(l.lr_date))
        .filter((d): d is string => !!d && deliveredOn < d.slice(0, 10))
        .sort()
        .pop();
      if (earliest) {
        const [y, m, d] = earliest.slice(0, 10).split("-");
        issues.push({
          path: "unloadedAt",
          message: `Delivery date can't be before the LR date (${d}-${m}-${y})`,
        });
      }
    }
    if (issues.length) throw new ValidationError(issues);

    const plan = planAutoLines(s.charges, computeAutos(s, dates, delivered));

    // The LR PODs (single storage), through the LR POD functions in this transaction. Inputs are
    // parsed here first, so nothing is sent before every check has passed.
    const factsChanged =
      dates.unloadedAt !== isoOrNull(c.unloaded_at) ||
      dates.podReceivedAt !== isoOrNull(c.pod_received_at);
    const podWrites: (() => Promise<Pod>)[] = [];
    const podLrs: string[] = [];
    if (lrPods && dates.unloadedAt) {
      const deliveredOn = indiaDate(dates.unloadedAt);
      for (const l of s.lines) {
        const x = given.get(l.lr_id);
        if (!x && !factsChanged) continue;
        const d = delivered.get(l.lr_id) ?? null;
        const short = d !== null && d < l.loaded_pkgs;
        const condition =
          x?.condition ??
          (short && l.pod_condition !== "damaged" ? "short" : l.pod_id ? undefined : "good");
        let remarks = x?.remarks;
        if (remarks === undefined && short && condition === "short" && !l.pod_remarks)
          remarks = `${l.loaded_pkgs - d} of ${l.loaded_pkgs} packages short (challan ${c.challan_no})`;
        const fields = {
          deliveredOn,
          ...(d !== null ? { packagesReceived: d + Number(l.other_delivered ?? 0) } : {}),
          ...(condition ? { condition } : {}),
          ...(remarks !== undefined ? { remarks } : {}),
          ...(x?.documentUrls ? { documentUrls: x.documentUrls } : {}),
          ...(dates.podReceivedAt ? { receivedAt: dates.podReceivedAt } : l.pod_id ? { receivedAt: null } : {}),
        };
        podLrs.push(l.lr_id);
        if (l.pod_id) {
          const patch = parseInput(podPatchFields, fields);
          podWrites.push(() => updatePodIn(tx, companyId, l.pod_id, l.pod_version, patch));
        } else {
          const pod = parseInput(podFields, { lrId: l.lr_id, ...fields });
          podWrites.push(() => createPodIn(tx, companyId, pod, role));
        }
      }
    }

    // The challan: dates + status at the expected version (one locked statement), pipelined with the
    // LR POD writes.
    const saving = saveRow(
      tx,
      "challans",
      companyId,
      id,
      version,
      {
        reported_at: dates.reportedAt,
        unloaded_at: dates.unloadedAt,
        pod_received_at: dates.podReceivedAt,
        status: statusAfterPod(c.status, dates.podReceivedAt),
      },
      { what: "Challan" },
    );
    const [{ after }, pods] = await Promise.all([saving, Promise.all(podWrites.map((w) => w()))]);

    // Delivered packages on the challan lines, then the system lines: both go out with the commit.
    const lineRows = [...given.values()]
      .filter((x) => x.deliveredPkgs !== undefined)
      .map((x) => ({ lr_id: x.lrId, d: x.deliveredPkgs }));
    if (lineRows.length)
      withCommit(
        tx,
        tx`update challan_lrs cl set delivered_pkgs = x.d
             from jsonb_to_recordset(${tx.json(lineRows as never)}::jsonb) as x(lr_id uuid, d int)
            where cl.company_id = ${companyId} and cl.challan_id = ${id} and cl.lr_id = x.lr_id
              and cl.transferred_to_challan_id is null`,
      );
    writeAutoLines(tx, companyId, id, plan);

    const before = new Map(s.lines.map((l) => [l.lr_id as string, (l.delivered_pkgs as number | null) ?? null]));
    audit(tx, companyId, "challans", id, "update", podAuditView(c, before), podAuditView(after, delivered));

    const podByLr = new Map(podLrs.map((lrId, i) => [lrId, pods[i]]));
    return build(
      s,
      after,
      s.lines.map((l) => toLine(l, delivered.get(l.lr_id) ?? null, podByLr.get(l.lr_id))),
      plan.after,
    );
  }
}

// ---------- LR POD → challan (two-way sync) ----------
/** Live, dispatched challans carrying this LR (app.lr_live_challans works for drivers too). */
export function liveChallansForLr(tx: Tx, companyId: string, lrId: Fragment | string) {
  return tx`select * from app.lr_live_challans(${companyId}::uuid, ${lrId}::uuid)`;
}

/** What the LR POD screen just saved. deliveredOn undefined = delivery date not changed. */
export type LrPodFacts = {
  lrId: string;
  deliveredOn: string | undefined;
  receivedAt: string | null;
  packagesReceived: number | null;
};

const indiaMidnight = (date: string) => new Date(`${date}T00:00:00+05:30`).toISOString();

/**
 * After an LR POD save (LR POD screen or driver app), brings the LR's challan in line, in the same
 * transaction: unloading date = delivery date, POD received = the POD's received date, delivered
 * packages = packages received − what the LR's other challans delivered. A settled challan refuses.
 * An LR split over several challans is left alone (each truck's challan has its own dates / count;
 * record those on the challan's POD screen).
 * Office users go through recordChallanPodIn (late-POD fee and shortage recomputed). A driver can't
 * read or write challans, so app.sync_challan_pod_from_lr writes the dates / status / packages only.
 */
export async function syncChallanFromLrPod(
  tx: Tx,
  companyId: string,
  challans: Row[],
  pod: LrPodFacts,
  role: Role,
): Promise<void> {
  if (!challans.length) return;
  const settled = challans.find((c) => c.status === "settled");
  if (settled) fail("", `Challan ${settled.challan_no} is settled; reopen it to change POD`);
  if (challans.length > 1) return;
  const c = challans[0];

  const unloadedAt =
    pod.deliveredOn === undefined ||
    (c.unloaded_at && indiaDate(new Date(c.unloaded_at).toISOString()) === pod.deliveredOn)
      ? undefined
      : indiaMidnight(pod.deliveredOn);
  let deliveredPkgs: number | undefined;
  if (pod.packagesReceived !== null) {
    const d = pod.packagesReceived - Number(c.other_delivered ?? 0);
    if (d < 0 || d > c.loaded_pkgs)
      fail(
        "packagesReceived",
        `Challan ${c.challan_no} loaded ${c.loaded_pkgs} packages of this LR` +
          (Number(c.other_delivered) ? ` (other challans delivered ${c.other_delivered})` : ""),
      );
    if (d !== c.delivered_pkgs) deliveredPkgs = d;
  }
  const receivedChanged = pod.receivedAt !== isoOrNull(c.pod_received_at);
  if (unloadedAt === undefined && deliveredPkgs === undefined && !receivedChanged) return;

  if (can(role, "freight.view") && (can(role, "lr.edit") || can(role, "bill.edit"))) {
    await recordChallanPodIn(
      tx,
      companyId,
      c.id,
      null,
      {
        reportedAt: undefined,
        unloadedAt,
        podReceivedAt: pod.receivedAt,
        lrs: deliveredPkgs === undefined ? [] : [{ lrId: pod.lrId, deliveredPkgs }],
      },
      role,
      false,
    );
    return;
  }
  const [after] = await tx`
    select * from app.sync_challan_pod_from_lr(${companyId}::uuid, ${pod.lrId}::uuid, ${c.id}::uuid)`;
  if (after?.changed)
    audit(
      tx,
      companyId,
      "challans",
      c.id,
      "update",
      podAuditView(c, new Map([[pod.lrId, c.delivered_pkgs ?? null]])),
      podAuditView(after, new Map([[pod.lrId, after.delivered_pkgs ?? null]])),
    );
}

/**
 * POD-stage charges: manual lines (charge type, direction add / deduct, truck amount, optional party
 * amount) and the late-POD fee override. Party detention / unloading are never computed: only a filled
 * party amount makes a line billable. Billed lines are frozen. One transaction; bumps the challan version.
 */
export async function saveChallanPodCharges(
  companyId: string,
  id: string,
  expectedVersion: number,
  v: ChallanPodChargesValues,
): Promise<ChallanSettlement> {
  if (!UUID.test(id)) throw new NotFoundError("Challan");
  return withUser(async (tx) => {
    const typeIds = v.charges.map((x) => x.chargeTypeId);
    const [s, types] = await Promise.all([
      load(tx, companyId, id, true),
      typeIds.length
        ? tx`select id, label, code, default_direction, stage, active from charge_types
              where company_id = ${companyId} and id in ${uuidsIn(tx, typeIds)} and cancelled_at is null`
        : Promise.resolve([] as Row[]),
    ]);
    if (!s) throw new NotFoundError("Challan");
    assertOpen(s.c, expectedVersion);

    const issues: Issue[] = [];
    const bad = (path: string, message: string) => void issues.push({ path, message });
    const byId = new Map(s.charges.map((g) => [g.id as string, g]));
    const typeById = new Map((types as Row[]).map((t) => [t.id as string, t]));
    const lrNo = new Map(s.lines.map((l) => [l.lr_id as string, l.lr_no as string]));
    const onlyLr = s.lines.length === 1 ? (s.lines[0].lr_id as string) : null;
    const after = new Map(s.charges.map((g) => [g.id as string, g]));
    const updates: { before: Row; row: Row }[] = [];
    const inserts: Row[] = [];
    const touched = new Set<string>();

    v.charges.forEach((x, i) => {
      const p = `charges.${i}`;
      const cur = x.id ? byId.get(x.id) : undefined;
      if (x.id && !cur) return bad(`${p}.id`, "Charge not found on this challan");
      if (x.id && touched.has(x.id)) return bad(`${p}.id`, "This charge is listed twice");
      if (x.id) touched.add(x.id);
      if (cur?.auto_kind)
        return bad(`${p}.id`, "System lines follow the POD dates and packages — override the late-POD fee instead");
      if (cur?.billed_live)
        return bad(p, `Already on freight bill ${cur.bill_no ?? "(draft)"} — cancel that bill to change it`);
      const t = typeById.get(x.chargeTypeId);
      if (!t) return bad(`${p}.chargeTypeId`, "Charge type not found");
      if (t.stage !== "pod") return bad(`${p}.chargeTypeId`, `${t.label} is added on the challan, not at POD`);
      if (!t.active && cur?.charge_type_id !== x.chargeTypeId)
        return bad(`${p}.chargeTypeId`, `${t.label} is switched off in Hire masters`);
      let lrId = x.lrId ?? null;
      if (lrId && !lrNo.has(lrId)) return bad(`${p}.lrId`, "This LR isn't on the challan");
      const amountPaise = toPaise(x.amount);
      const partyPaise = toPaise(x.partyAmount ?? null);
      if (partyPaise > 0 && !lrId) lrId = onlyLr;
      if (partyPaise > 0 && !lrId) return bad(`${p}.lrId`, "Pick the LR whose party is billed");
      if (amountPaise === 0 && partyPaise === 0)
        return bad(`${p}.amount`, "Enter the truck amount, the party amount, or both");
      const row: Row = {
        id: cur?.id ?? newId(),
        charge_type_id: x.chargeTypeId,
        lr_id: lrId,
        direction: x.direction ?? t.default_direction,
        amount: fromPaise(amountPaise),
        bill_party: partyPaise > 0,
        party_amount: partyPaise > 0 ? fromPaise(partyPaise) : null,
        note: x.note ?? null,
      };
      const shown: Row = {
        ...(cur ?? {
          version: 1,
          stage: "pod",
          auto_kind: null,
          auto_amount: null,
          override_reason: null,
          billed_in_freight_bill_id: null,
          billed_live: false,
          bill_no: null,
        }),
        ...row,
        label: t.label,
        code: t.code,
        lr_no: lrId ? lrNo.get(lrId) : null,
      };
      if (cur) updates.push({ before: cur, row: shown });
      else inserts.push(shown);
      after.set(row.id, shown);
    });

    v.remove.forEach((rid, i) => {
      const g = byId.get(rid);
      if (!g) return bad(`remove.${i}`, "Charge not found on this challan");
      if (g.auto_kind) return bad(`remove.${i}`, "System lines can't be removed — override the amount instead");
      if (g.billed_live) return bad(`remove.${i}`, `Already on freight bill ${g.bill_no ?? "(draft)"}`);
      if (touched.has(rid)) return bad(`remove.${i}`, "This charge is both edited and removed");
      after.delete(rid);
    });

    // Late-POD fee override (with a reason) or back to the auto amount.
    const late = s.charges.find((g) => g.auto_kind === "late_pod");
    let lateRow: Row | null = null;
    if (v.latePodOverride !== undefined) {
      const autoPaise = toPaise(str(late?.auto_amount));
      const { paise, overridden } = appliedAutoPaise(autoPaise, v.latePodOverride);
      const reason = overridden ? v.latePodOverride!.reason : null;
      if (late && (toPaise(String(late.amount)) !== paise || late.override_reason !== reason)) {
        lateRow = { ...late, amount: fromPaise(paise), override_reason: reason };
      } else if (!late && overridden) {
        lateRow = {
          id: newId(),
          version: 1,
          charge_type_id: null,
          label: null,
          auto_kind: "late_pod",
          lr_id: null,
          lr_no: null,
          direction: "deduct",
          amount: fromPaise(paise),
          auto_amount: "0.00",
          override_reason: reason,
          bill_party: false,
          party_amount: null,
          billed_in_freight_bill_id: null,
          billed_live: false,
          note: null,
        };
      }
      if (lateRow) after.set(lateRow.id, lateRow);
    }
    if (issues.length) throw new ValidationError(issues);

    // Bump the challan's version (the screen's conflict check covers its charges too).
    const { after: c } = await saveRow(
      tx,
      "challans",
      companyId,
      id,
      expectedVersion,
      { updated_at: tx`now()` },
      { what: "Challan" },
    );

    const cols = (r: Row) => ({
      id: r.id,
      charge_type_id: r.charge_type_id,
      lr_id: r.lr_id,
      direction: r.direction,
      amount: r.amount,
      bill_party: r.bill_party,
      party_amount: r.party_amount,
      note: r.note,
    });
    const recordset = (rows: Row[]) =>
      tx`jsonb_to_recordset(${tx.json(rows.map(cols) as never)}::jsonb)
           as x(id uuid, charge_type_id uuid, lr_id uuid, direction text, amount numeric,
                bill_party boolean, party_amount numeric, note text)`;
    if (updates.length)
      withCommit(
        tx,
        tx`update challan_charges g
              set charge_type_id = x.charge_type_id, lr_id = x.lr_id,
                  direction = x.direction::charge_direction, amount = x.amount,
                  bill_party = x.bill_party, party_amount = x.party_amount, note = x.note
             from ${recordset(updates.map((u) => u.row))}
            where g.company_id = ${companyId} and g.challan_id = ${id} and g.id = x.id
              and g.auto_kind is null`,
      );
    if (inserts.length)
      withCommit(
        tx,
        tx`insert into challan_charges (id, company_id, challan_id, charge_type_id, lr_id, stage,
                                        direction, amount, bill_party, party_amount, note)
           select x.id, ${companyId}::uuid, ${id}::uuid, x.charge_type_id, x.lr_id, 'pod',
                  x.direction::charge_direction, x.amount, x.bill_party, x.party_amount, x.note
             from ${recordset(inserts)}`,
      );
    if (v.remove.length)
      withCommit(
        tx,
        tx`update challan_charges set cancelled_at = now(), cancel_reason = 'Removed at POD settlement'
            where company_id = ${companyId} and challan_id = ${id} and id in ${uuidsIn(tx, v.remove)}
              and auto_kind is null`,
      );
    if (lateRow && late)
      withCommit(
        tx,
        tx`update challan_charges set amount = ${lateRow.amount}::numeric,
                                      override_reason = ${lateRow.override_reason}
            where company_id = ${companyId} and challan_id = ${id} and id = ${late.id}`,
      );
    else if (lateRow)
      withCommit(
        tx,
        tx`insert into challan_charges (id, company_id, challan_id, stage, direction, amount,
                                        auto_kind, auto_amount, override_reason)
           values (${lateRow.id}, ${companyId}, ${id}, 'pod', 'deduct', ${lateRow.amount}::numeric,
                   'late_pod', 0, ${lateRow.override_reason})`,
      );

    for (const u of updates)
      audit(tx, companyId, "challan_charges", u.row.id, "update", toCharge(u.before), toCharge(u.row));
    for (const r of inserts) audit(tx, companyId, "challan_charges", r.id, "create", null, toCharge(r));
    for (const rid of v.remove) {
      const g = byId.get(rid)!;
      audit(tx, companyId, "challan_charges", rid, "cancel", toCharge(g), {
        ...toCharge(g),
        cancelReason: "Removed at POD settlement",
      });
    }
    if (lateRow)
      audit(
        tx,
        companyId,
        "challan_charges",
        lateRow.id,
        late ? "update" : "create",
        late ? toCharge(late) : null,
        toCharge(lateRow),
      );

    return build(
      s,
      c,
      s.lines.map((l) => toLine(l, l.delivered_pkgs ?? null, undefined)),
      [...after.values()],
    );
  });
}

/**
 * pod_received → settled. Payments are not required (owner decision). Locks the POD fields.
 * First brings the late-POD fee and shortage lines to the current dates / delivered packages (a
 * driver's POD sync writes those without recomputing); a manual late-POD override keeps its amount.
 */
export async function settleChallan(
  companyId: string,
  id: string,
  expectedVersion: number,
): Promise<ChallanSettlementState> {
  if (!UUID.test(id)) throw new NotFoundError("Challan");
  return withUser(async (tx) => {
    const s = await load(tx, companyId, id, true);
    if (!s) throw new NotFoundError("Challan");
    const { c } = s;
    if (c.cancelled_at) fail("", "This challan is cancelled");
    if (c.version !== expectedVersion) throw new ConflictError();
    const p = settleProblem(c.status, c.pod_received_at);
    if (p) fail("", p);

    const delivered = new Map(
      s.lines.map((l) => [l.lr_id as string, (l.delivered_pkgs as number | null) ?? null]),
    );
    const dates: PodDates = {
      reportedAt: isoOrNull(c.reported_at),
      unloadedAt: isoOrNull(c.unloaded_at),
      podReceivedAt: isoOrNull(c.pod_received_at),
    };
    // Sent now (before the status change below, on the same connection), so the settled lock on
    // challan_charges doesn't see them; they still leave without an extra round trip.
    writeAutoLines(tx, companyId, id, planAutoLines(s.charges, computeAutos(s, dates, delivered)));

    const { before, after } = await saveRow(
      tx,
      "challans",
      companyId,
      id,
      expectedVersion,
      { status: "settled", settled_at: tx`now()` },
      {
        what: "Challan",
        guard: tx`cur.status = 'pod_received' and cur.pod_received_at is not null`,
        validate: (b) => {
          const p = settleProblem(b.status, b.pod_received_at);
          if (p) fail("", p);
        },
      },
    );
    const state = toState(after);
    audit(tx, companyId, "challans", id, "update", toState(before), state);
    return state;
  });
}

/** settled → pod_received with a reason (record.cancel, checked by the caller and the trigger). */
export async function reopenChallan(
  companyId: string,
  id: string,
  expectedVersion: number,
  reason: string,
): Promise<ChallanSettlementState> {
  if (!UUID.test(id)) throw new NotFoundError("Challan");
  return withUser(async (tx) => {
    const { before, after } = await saveRow(
      tx,
      "challans",
      companyId,
      id,
      expectedVersion,
      { status: "pod_received", settled_at: null, reopened_at: tx`now()`, reopen_reason: reason },
      {
        what: "Challan",
        guard: tx`cur.status = 'settled'`,
        validate: (b) => {
          if (b.status !== "settled") fail("", "Only a settled challan can be reopened");
        },
      },
    );
    const state = toState(after);
    audit(tx, companyId, "challans", id, "update", toState(before), state);
    return state;
  });
}

// ---------- freight bill: party-billable charges ----------
/** Party-billable POD charges on no live bill, for the party (LR billed-to, else consignee). */
export async function listUnbilledChallanCharges(
  companyId: string,
  partyId?: string,
): Promise<UnbilledChallanCharge[]> {
  if (partyId !== undefined && !UUID.test(partyId)) return [];
  return withUserRead(async (tx) => {
    const rows = await tx`
      select g.id, g.version, g.challan_id, c.challan_no, g.lr_id, l.lr_no, g.party_amount,
             t.code, t.bill_column, coalesce(t.label, g.auto_kind::text) as label,
             coalesce(l.billed_to_id, l.consignee_id) as party_id
        from challan_charges g
        join challans c on c.company_id = g.company_id and c.id = g.challan_id
        join lrs l on l.company_id = g.company_id and l.id = g.lr_id
        left join charge_types t on t.company_id = g.company_id and t.id = g.charge_type_id
        left join freight_bills b on b.company_id = g.company_id and b.id = g.billed_in_freight_bill_id
       where g.company_id = ${companyId} and g.bill_party and g.cancelled_at is null
         and c.cancelled_at is null and l.cancelled_at is null
         and (g.billed_in_freight_bill_id is null or b.cancelled_at is not null)
         ${partyId ? tx`and coalesce(l.billed_to_id, l.consignee_id) = ${partyId}` : tx``}
       order by c.challan_at, c.challan_no, g.created_at, g.id
       limit 500`;
    return rows.map((r) => ({
      chargeId: r.id,
      version: r.version,
      challanId: r.challan_id,
      challanNo: r.challan_no,
      lrId: r.lr_id,
      lrNo: r.lr_no,
      partyId: r.party_id ?? null,
      label: r.label ?? "",
      column: lineColumn(r.bill_column),
      partyAmountPaise: toPaise(String(r.party_amount)),
    }));
  });
}

/** The picked charges, locked for the bill being created. */
export function lockChargesForBill(tx: Tx, companyId: string, ids: string[]) {
  return tx`
    select g.id, g.lr_id, g.bill_party, g.party_amount, g.cancelled_at, g.billed_in_freight_bill_id,
           l.lr_no, t.code, t.bill_column, coalesce(t.label, g.auto_kind::text) as label,
           c.cancelled_at as challan_cancelled, b.bill_no,
           (b.id is not null and b.cancelled_at is null) as billed_live
      from challan_charges g
      join challans c on c.company_id = g.company_id and c.id = g.challan_id
      left join lrs l on l.company_id = g.company_id and l.id = g.lr_id
      left join charge_types t on t.company_id = g.company_id and t.id = g.charge_type_id
      left join freight_bills b on b.company_id = g.company_id and b.id = g.billed_in_freight_bill_id
     where g.company_id = ${companyId} and g.id in ${uuidsIn(tx, ids)}
       for update of g`;
}

/**
 * The bill line column for a charge type's bill_column (0021). The freight bill has only detention
 * and other columns, so unloading (and system lines with no charge type) are billed under other.
 */
const lineColumn = (billColumn: unknown): "detention" | "other" =>
  billColumn === "detention" ? "detention" : "other";

/** Adds each charge's party amount to its LR's bill line (detention or other column). */
export function addChargesToLines<
  L extends { lrId: string; detentionPaise?: number | null; otherPaise?: number | null },
>(lines: L[], rows: Row[], ids: string[]): L[] {
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const out = lines.map((l) => ({ ...l }));
  const at = new Map(out.map((l, i) => [l.lrId, i]));
  const seen = new Set<string>();
  ids.forEach((cid, i) => {
    const path = `charges.${i}`;
    if (seen.has(cid)) fail(path, "This charge is picked twice");
    seen.add(cid);
    const g = byId.get(cid);
    if (!g || g.cancelled_at || g.challan_cancelled) fail(path, "Charge not found in this company");
    if (!g.bill_party || !g.party_amount) fail(path, "This charge isn't billable to the party");
    if (g.billed_live) fail(path, `Already on freight bill ${g.bill_no ?? "(draft)"}`);
    const idx = at.get(g.lr_id);
    if (idx === undefined) fail(path, `Add LR ${g.lr_no ?? ""} to this bill to bill ${g.label ?? "this charge"}`);
    const paise = toPaise(String(g.party_amount));
    const line = out[idx];
    if (lineColumn(g.bill_column) === "detention")
      line.detentionPaise = (line.detentionPaise ?? 0) + paise;
    else line.otherPaise = (line.otherPaise ?? 0) + paise;
  });
  return out;
}

/**
 * Marks the charges billed on `billId`, in the bill's own transaction. Only unbilled lines (or lines
 * left on a cancelled bill) match; the b3_charge_guard trigger refuses any other move.
 */
export function markChargesBilled(tx: Tx, companyId: string, billId: string, ids: string[]): Fragment {
  return tx`
    update challan_charges g set billed_in_freight_bill_id = ${billId}
     where g.company_id = ${companyId} and g.id in ${uuidsIn(tx, ids)}
       and g.bill_party and g.cancelled_at is null
       and (g.billed_in_freight_bill_id is null or exists (
             select 1 from freight_bills b
              where b.company_id = g.company_id and b.id = g.billed_in_freight_bill_id
                and b.cancelled_at is not null))
    returning g.id`;
}

/** Audit rows for charges just billed. */
export function auditChargesBilled(tx: Tx, companyId: string, billId: string, rows: Row[]) {
  for (const r of rows)
    audit(
      tx,
      companyId,
      "challan_charges",
      r.id,
      "update",
      { billedInFreightBillId: r.billed_in_freight_bill_id ?? null },
      { billedInFreightBillId: billId },
    );
}

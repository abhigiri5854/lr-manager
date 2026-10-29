// POD & delivery on the database (DATA_SOURCE=db). Same behaviour as the mock half of ../pod.ts.
// Delivery lives on the LR (app.set_lr_delivered); "POD received" is cached on the LR by the
// g_lr_stamps trigger on pods, so a POD write needs no stamp bookkeeping here. The LR facts a POD
// save checks come from app.lr_pod_info, which also works for a driver on their own trip.
import { daysBetween, todayInIndia } from "@/lib/fy";
import { can } from "@/lib/permissions";
import { podLateDays, podPenaltyPaise } from "@/lib/pod-rules";
import type { Company, LrView, Page, Pod, Role } from "@/lib/types";
import type { podFields } from "@/lib/validators/pod";
import type { z } from "zod";
import { fail, newId, now, today } from "../_store";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import type { PodPatch, PodPendingItem, PodScreen } from "../pod";
import { assertDeliveryRules, deliveredAtFrom } from "../pod";
import type { ListParams } from "../_store";
import { contains, paging, withUser, withUserRead, type Tx } from "./conn";
import { getLrById, isUuid, listLrs } from "./lrs";
import { audit, toPod, type Row } from "./rows";
import { cancelRow } from "./write";
import { podPathFromUrl } from "./storage";

// ---------- pending list ----------
function pendingWhere(
  tx: Tx,
  companyId: string,
  params: ListParams & { overdueOnly?: boolean },
  asOf: string,
) {
  const q = contains(params.search);
  return tx`l.company_id = ${companyId} and l.cancelled_at is null
    and l.delivered_at is not null and l.pod_received_at is null
    ${
      q
        ? tx`and (lower(l.lr_no) like ${q} or lower(ce.name) like ${q})`
        : tx``
    }
    ${
      params.overdueOnly
        ? tx`and c.pod_days is not null
             and (${asOf}::date - (l.delivered_at at time zone 'utc')::date) > c.pod_days`
        : tx``
    }`;
}

const PENDING_FROM = (tx: Tx) => tx`from lrs l
  join companies c on c.id = l.company_id
  left join parties ce on ce.company_id = l.company_id and ce.id = l.consignee_id`;

export function toPendingItem(r: Row, asOf: string): PodPendingItem {
  const deliveredOn = (r.delivered_at as string).slice(0, 10);
  const rules = { podDays: r.pod_days as number | null, podPenaltyPerDay: r.penalty as number | null };
  return {
    lrId: r.id,
    lrNo: r.lr_no,
    deliveredOn,
    consignee: r.consignee ?? "",
    daysSinceDelivery: daysBetween(r.delivered_at, asOf),
    penaltyPaise: podPenaltyPaise(deliveredOn, asOf, rules),
    overdue: podLateDays(deliveredOn, asOf, rules.podDays) > 0,
  };
}

export const PENDING_COLS = (tx: Tx) => tx`l.id, l.lr_no, l.delivered_at, ce.name as consignee,
  c.pod_days, c.pod_penalty_per_day_paise as penalty`;

export async function listPodPendingPage(
  companyId: string,
  params: ListParams & { overdueOnly?: boolean },
): Promise<Page<PodPendingItem>> {
  const { page, pageSize, offset } = paging(params);
  const asOf = today();
  return withUserRead(async (tx) => {
    const [rows, [{ n }]] = await Promise.all([
      tx`select ${PENDING_COLS(tx)} ${PENDING_FROM(tx)}
          where ${pendingWhere(tx, companyId, params, asOf)}
          order by l.delivered_at, l.id limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n ${PENDING_FROM(tx)}
          where ${pendingWhere(tx, companyId, params, asOf)}`,
    ]);
    return { rows: rows.map((r) => toPendingItem(r, asOf)), total: n as number, page, pageSize };
  });
}

/** Booked LRs that haven't been delivered yet ("In transit" tab). */
export async function listInTransitForPod(
  companyId: string,
  params: ListParams,
): Promise<Page<LrView>> {
  return listLrs(companyId, { ...params, statuses: ["Booked", "In transit"] });
}

// ---------- POD screen ----------
export async function getPodScreen(companyId: string, lrId: string): Promise<PodScreen | null> {
  if (!isUuid(lrId)) return null;
  return withUserRead(async (tx) => {
    const [lr, pod, [company]] = await Promise.all([
      getLrById(companyId, lrId),
      getPodByLrId(companyId, lrId),
      tx`select pod_days, pod_penalty_per_day_paise from companies where id = ${companyId}`,
    ]);
    if (!lr || !company) return null;
    return {
      lr,
      pod,
      podDays: company.pod_days as Company["podDays"],
      podPenaltyPerDay: company.pod_penalty_per_day_paise as Company["podPenaltyPerDay"],
      today: todayInIndia(),
    };
  });
}

export async function listPods(companyId: string, params: ListParams): Promise<Page<Pod>> {
  const { page, pageSize, offset } = paging(params);
  const q = contains(params.search);
  return withUserRead(async (tx) => {
    const where = () => tx`p.company_id = ${companyId} and p.cancelled_at is null
      ${
        q
          ? tx`and (lower(l.lr_no) like ${q} or lower(p.received_by) like ${q}
                    or lower(p.receiver_phone) like ${q})`
          : tx``
      }`;
    const from = tx`from pods p join lrs l on l.company_id = p.company_id and l.id = p.lr_id`;
    const [rows, [{ n }]] = await Promise.all([
      tx`select p.* ${from} where ${where()} order by p.created_at desc, p.id
          limit ${pageSize} offset ${offset}`,
      tx`select count(*) as n ${from} where ${where()}`,
    ]);
    return { rows: rows.map(toPod), total: n as number, page, pageSize };
  });
}

export async function getPodById(companyId: string, id: string): Promise<Pod | null> {
  if (!isUuid(id)) return null;
  return withUserRead(async (tx) => {
    const [r] = await tx`select * from pods where company_id = ${companyId} and id = ${id}`;
    return r ? toPod(r) : null;
  });
}

export async function getPodByLrId(companyId: string, lrId: string): Promise<Pod | null> {
  if (!isUuid(lrId)) return null;
  return withUserRead(async (tx) => {
    const [r] = await tx`select * from pods where company_id = ${companyId} and lr_id = ${lrId}
                            and cancelled_at is null`;
    return r ? toPod(r) : null;
  });
}

// ---------- writes ----------
/** Links of this LR's uploads → the storage paths kept on the POD. */
function documentPaths(companyId: string, lrId: string, urls: string[]): string[] {
  try {
    return urls.map((u) => podPathFromUrl(companyId, lrId, u));
  } catch {
    return fail("documentUrls", "Upload the file again");
  }
}

const POD_COLUMNS = {
  receivedBy: "received_by",
  receiverPhone: "receiver_phone",
  packagesReceived: "packages_received",
  condition: "condition",
  remarks: "remarks",
  receivedAt: "received_at",
} as const;

/** Writes the LR's delivery date (its single home) and returns the audit change. */
function setDelivered(
  tx: Tx,
  companyId: string,
  lrId: string,
  deliveredAt: string | null,
  was: { delivered_at: string | null; dispatched_at: string | null },
) {
  const done = tx`select app.set_lr_delivered(${companyId}, ${lrId}, ${deliveredAt})`.execute();
  const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
  const before = { deliveredAt: iso(was.delivered_at), dispatchedAt: iso(was.dispatched_at) };
  const after = { deliveredAt, dispatchedAt: before.dispatchedAt ?? deliveredAt };
  const record = () => {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      audit(tx, companyId, "lrs", lrId, "update", before, after);
    }
  };
  return { done, record };
}

export async function createPod(
  companyId: string,
  v: z.output<typeof podFields>,
  role: Role,
): Promise<Pod> {
  const paths = documentPaths(companyId, v.lrId, v.documentUrls ?? []);
  return withUser(async (tx) => {
    const [[lr], [existing]] = await Promise.all([
      tx`select * from app.lr_pod_info(${companyId}, ${v.lrId})`,
      tx`select 1 as x from pods where company_id = ${companyId} and lr_id = ${v.lrId}
            and cancelled_at is null`,
    ]);
    if (!lr) {
      if (can(role, "pod.upload")) fail("lrId", "LR not found in this company");
      throw new ForbiddenError("Drivers can only record POD for their own trips.");
    }
    if (lr.cancelled_at) fail("lrId", "LR not found in this company");
    if (!lr.booked_at) fail("lrId", "Book the LR before recording delivery");
    if (existing) fail("lrId", "This LR already has a POD — edit it instead");
    assertDeliveryRules(v.deliveredOn, v.condition ?? "good", v.remarks ?? null);

    const delivery = setDelivered(tx, companyId, v.lrId, deliveredAtFrom(v.deliveredOn), lr as never);
    const row = {
      id: newId(),
      company_id: companyId,
      lr_id: v.lrId,
      received_by: v.receivedBy ?? null,
      receiver_phone: v.receiverPhone ?? null,
      packages_received: v.packagesReceived ?? null,
      condition: v.condition ?? "good",
      remarks: v.remarks ?? null,
      document_paths: paths,
      received_at: v.receivedAt ?? (paths.length ? now() : null),
    };
    const [, [saved]] = await Promise.all([
      delivery.done,
      tx`insert into pods ${tx(row as never)} returning *`,
    ]);
    delivery.record();
    const pod = toPod(saved);
    audit(tx, companyId, "pods", pod.id, "create", null, pod);
    return pod;
  });
}

export async function updatePod(
  companyId: string,
  id: string,
  expectedVersion: number,
  p: PodPatch,
): Promise<Pod> {
  const { deliveredOn, documentUrls, ...fields } = p;
  return withUser(async (tx) => {
    if (!isUuid(id)) throw new NotFoundError("POD");
    const [cur] = await tx`
      select p.*, (select row_to_json(i) from app.lr_pod_info(p.company_id, p.lr_id) i) as lr
        from pods p where p.company_id = ${companyId} and p.id = ${id} for update of p`;
    if (!cur) throw new NotFoundError("POD");
    if (!cur.lr) throw new ForbiddenError("Drivers can only record POD for their own trips.");
    if (cur.cancelled_at) fail("", "This POD is cancelled and can't be changed");
    if (cur.version !== expectedVersion) throw new ConflictError();
    assertDeliveryRules(
      deliveredOn,
      fields.condition ?? cur.condition,
      fields.remarks !== undefined ? fields.remarks : cur.remarks,
    );

    const before = toPod(cur);
    const set: Row = {};
    for (const [key, col] of Object.entries(POD_COLUMNS) as [keyof typeof POD_COLUMNS, string][]) {
      if (key in fields) set[col] = (fields as Record<string, unknown>)[key] ?? null;
    }
    const paths = documentUrls ? documentPaths(companyId, cur.lr_id, documentUrls) : null;
    if (paths) set.document_paths = paths;
    const docs = paths ?? (cur.document_paths as string[]);
    const receivedAt = "received_at" in set ? set.received_at : cur.received_at;
    if (!receivedAt && docs.length) set.received_at = now();

    const delivery = deliveredOn
      ? setDelivered(tx, companyId, cur.lr_id, deliveredAtFrom(deliveredOn), cur.lr)
      : null;
    const [, [saved]] = await Promise.all([
      delivery?.done,
      tx`update pods set ${tx(set as never)}
          where company_id = ${companyId} and id = ${id} and version = ${expectedVersion}
          returning *`,
    ]);
    if (!saved) throw new ConflictError();
    delivery?.record();
    const pod = toPod(saved);
    audit(tx, companyId, "pods", id, "update", before, pod);
    return pod;
  });
}

/** Cancelling a POD also clears the LR's delivery date (it was recorded by mistake). */
export async function cancelPod(companyId: string, id: string): Promise<Pod> {
  return withUser(async (tx) => {
    if (!isUuid(id)) throw new NotFoundError("POD");
    const { before, after, changed } = await cancelRow(tx, "pods", companyId, id, "POD");
    const pod = toPod(after);
    if (changed) {
      const [lr] = await tx`select delivered_at, dispatched_at, cancelled_at from lrs
                             where company_id = ${companyId} and id = ${pod.lrId}`;
      audit(tx, companyId, "pods", id, "cancel", toPod(before), pod);
      if (lr && !lr.cancelled_at) {
        const delivery = setDelivered(tx, companyId, pod.lrId, null, lr as never);
        await delivery.done;
        delivery.record();
      }
    }
    return pod;
  });
}

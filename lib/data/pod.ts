import { daysBetween, todayInIndia } from "@/lib/fy";
import { can } from "@/lib/permissions";
import { podLateDays, podPenaltyPaise } from "@/lib/pod-rules";
import type { Company, Lr, LrView, Page, Pod, PodPendingRow } from "@/lib/types";
import { podFields, type PodInput } from "@/lib/validators/pod";
import {
  cancelRecord,
  clone,
  db,
  fail,
  findById,
  getOrThrow,
  insertRecord,
  matchesSearch,
  newId,
  now,
  paginate,
  parseInput,
  scoped,
  today,
  updateRecord,
  type ListParams,
  authorStamp,
} from "./_store";
import { assertCan, getCurrentUserId } from "./session";
import { ConflictError, ForbiddenError } from "./errors";
import { getLrById, listLrsForExport } from "./lrs";
import { syncLrStampsForPod } from "./_derive";
import * as dbp from "./db/pod";
import { onDatabase } from "./source";

const podPatchSchema = podFields.omit({ lrId: true }).partial();
export type PodPatch = Partial<Omit<PodInput, "lrId">>;

/** "2026-10-20" → stored on Lr.deliveredAt as that UTC date. */
export const deliveredAtFrom = (date: string) => `${date}T00:00:00.000Z`;

/** Short / Damaged need a note from the consignee. Any delivery date is accepted (the form warns). */
export function assertDeliveryRules(
  deliveredOn: string | undefined,
  condition: Pod["condition"],
  remarks: string | null,
) {
  if (condition !== "good" && !remarks?.trim()) {
    fail("remarks", `Add remarks — what was ${condition === "short" ? "short" : "damaged"}?`);
  }
}

/** Writes the delivery date onto the LR (its single home). */
function setLrDelivered(companyId: string, lrId: string, deliveredAt: string | null) {
  const lr = getOrThrow(db.lrs, companyId, lrId, "LR");
  if (lr.cancelledAt) return;
  updateRecord(
    "lrs",
    db.lrs,
    companyId,
    lrId,
    lr.version,
    (c) => ({ ...c, deliveredAt, dispatchedAt: c.dispatchedAt ?? deliveredAt }),
    "LR",
  );
}

export type PodPendingItem = PodPendingRow & { overdue: boolean };

/** Every delivered LR still waiting for the signed POD, longest-waiting first. */
function pendingRows(companyId: string): PodPendingItem[] {
  const company = db.companies.find((c) => c.id === companyId);
  const received = new Set(
    scoped(db.pods, companyId)
      .filter((p) => p.receivedAt)
      .map((p) => p.lrId),
  );
  const asOf = today();
  return scoped(db.lrs, companyId)
    .filter((lr) => lr.deliveredAt && !received.has(lr.id))
    .map((lr) => {
      const deliveredOn = lr.deliveredAt!.slice(0, 10);
      return {
        lrId: lr.id,
        lrNo: lr.lrNo,
        deliveredOn,
        consignee: db.parties.find((p) => p.id === lr.consigneeId)?.name ?? "",
        daysSinceDelivery: daysBetween(lr.deliveredAt!, asOf),
        penaltyPaise: company ? podPenaltyPaise(deliveredOn, asOf, company) : 0,
        overdue: podLateDays(deliveredOn, asOf, company?.podDays ?? null) > 0,
      };
    })
    .sort((a, b) => b.daysSinceDelivery - a.daysSinceDelivery);
}

/** LRs of the company that are delivered and still waiting for the signed POD. */
export async function listPodPending(companyId: string): Promise<PodPendingRow[]> {
  // Pages are capped at 50 rows, so walk them all.
  const all: PodPendingRow[] = [];
  for (let page = 1; ; page++) {
    const { rows, total } = await listPodPendingPage(companyId, { page });
    all.push(...rows);
    if (all.length >= total || rows.length === 0) return all;
  }
}

/** POD pending list: searchable, optionally only the overdue ones, 50 per page. */
export async function listPodPendingPage(
  companyId: string,
  params: ListParams & { overdueOnly?: boolean },
): Promise<Page<PodPendingItem>> {
  if (onDatabase()) return dbp.listPodPendingPage(companyId, params);
  const rows = pendingRows(companyId)
    .filter((r) => !params.overdueOnly || r.overdue)
    .filter((r) => matchesSearch(params.search, r.lrNo, r.consignee));
  return paginate(rows, params);
}

/** Booked LRs that haven't been delivered yet ("In transit" tab). */
export async function listInTransitForPod(
  companyId: string,
  params: ListParams,
): Promise<Page<LrView>> {
  if (onDatabase()) return dbp.listInTransitForPod(companyId, params);
  const wanted = (v: LrView) => v.status === "Booked" || v.status === "In transit";
  const { rows } = await listLrsForExport(companyId, { search: params.search });
  return paginate(rows.filter(wanted), params);
}

export type PodScreen = {
  lr: LrView;
  pod: Pod | null;
  podDays: Company["podDays"];
  podPenaltyPerDay: Company["podPenaltyPerDay"];
  /** Today (India), for the "not in future" limit and the late-penalty preview. */
  today: string;
};

/** Everything the POD screen needs: the LR, its POD (if any) and the company's POD rules. */
export async function getPodScreen(companyId: string, lrId: string): Promise<PodScreen | null> {
  if (onDatabase()) return dbp.getPodScreen(companyId, lrId);
  const lr = await getLrById(companyId, lrId);
  const company = db.companies.find((c) => c.id === companyId);
  if (!lr || !company) return null;
  return {
    lr,
    pod: await getPodByLrId(companyId, lrId),
    podDays: company.podDays,
    podPenaltyPerDay: company.podPenaltyPerDay,
    today: todayInIndia(),
  };
}

export async function listPods(companyId: string, params: ListParams = {}): Promise<Page<Pod>> {
  if (onDatabase()) return dbp.listPods(companyId, params);
  const lrNo = (id: string) => db.lrs.find((l) => l.id === id)?.lrNo;
  const rows = scoped(db.pods, companyId)
    .filter((p) => matchesSearch(params.search, lrNo(p.lrId), p.receivedBy, p.receiverPhone))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(clone);
  return paginate(rows, params);
}

export async function getPodById(companyId: string, id: string): Promise<Pod | null> {
  if (onDatabase()) return dbp.getPodById(companyId, id);
  const p = findById(db.pods, companyId, id);
  return p ? clone(p) : null;
}

export async function getPodByLrId(companyId: string, lrId: string): Promise<Pod | null> {
  if (onDatabase()) return dbp.getPodByLrId(companyId, lrId);
  const p = scoped(db.pods, companyId).find((x) => x.lrId === lrId);
  return p ? clone(p) : null;
}

/**
 * Office roles ("pod.upload") may record POD on any LR; a driver ("pod.upload_own") only on
 * their own trips: the LR's driver mobile is theirs, or its truck has them as driver.
 */
async function assertPodAccess(companyId: string, lr: Lr): Promise<void> {
  const role = await assertCan(companyId, "pod.upload", "pod.upload_own");
  if (can(role, "pod.upload")) return;
  const userId = await getCurrentUserId();
  const driver = scoped(db.drivers, companyId).find((d) => d.userId === userId);
  const truck = lr.truckId ? findById(db.trucks, companyId, lr.truckId) : undefined;
  const own =
    driver !== undefined &&
    ((lr.driverMobile !== null && lr.driverMobile === driver.mobile) ||
      truck?.driverId === driver.id);
  if (!own) throw new ForbiddenError("Drivers can only record POD for their own trips.");
}

/** POD screen save: records delivery (marks the LR Delivered) and any signed copy received. */
export async function createPod(companyId: string, input: PodInput): Promise<Pod> {
  // Role first; whether this LR is the driver's own trip is checked once it's loaded.
  const role = await assertCan(companyId, "pod.upload", "pod.upload_own");
  const v = parseInput(podFields, input);
  if (onDatabase()) return dbp.createPod(companyId, v, role);
  const lr = findById(db.lrs, companyId, v.lrId);
  if (!lr || lr.cancelledAt) fail("lrId", "LR not found in this company");
  await assertPodAccess(companyId, lr);
  if (!lr.bookedAt) fail("lrId", "Book the LR before recording delivery");
  if (scoped(db.pods, companyId).some((p) => p.lrId === v.lrId)) {
    fail("lrId", "This LR already has a POD — edit it instead");
  }
  assertDeliveryRules(v.deliveredOn, v.condition ?? "good", v.remarks ?? null);

  setLrDelivered(companyId, v.lrId, deliveredAtFrom(v.deliveredOn));
  const documentUrls = v.documentUrls ?? [];
  const t = now();
  const pod: Pod = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...authorStamp(),
    lrId: v.lrId,
    receivedBy: v.receivedBy ?? null,
    receiverPhone: v.receiverPhone ?? null,
    packagesReceived: v.packagesReceived ?? null,
    condition: v.condition ?? "good",
    remarks: v.remarks ?? null,
    documentUrls,
    receivedAt: v.receivedAt ?? (documentUrls.length ? t : null),
  };
  const saved = insertRecord("pods", db.pods, pod);
  syncLrStampsForPod(saved);
  return saved;
}

export async function updatePod(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: PodPatch,
): Promise<Pod> {
  await assertCan(companyId, "pod.upload", "pod.upload_own");
  const p = parseInput(podPatchSchema, patch);
  if (onDatabase()) return dbp.updatePod(companyId, id, expectedVersion, p);
  const { deliveredOn, ...fields } = p;
  // Check the POD first so a conflict can't leave the LR half-updated (one transaction in Postgres).
  const existing = getOrThrow(db.pods, companyId, id, "POD");
  await assertPodAccess(companyId, findById(db.lrs, companyId, existing.lrId)!);
  if (existing.cancelledAt) fail("", "This POD is cancelled and can't be changed");
  if (existing.version !== expectedVersion) throw new ConflictError();
  assertDeliveryRules(
    deliveredOn,
    fields.condition ?? existing.condition,
    fields.remarks !== undefined ? fields.remarks : existing.remarks,
  );
  if (deliveredOn) setLrDelivered(companyId, existing.lrId, deliveredAtFrom(deliveredOn));
  const saved = updateRecord(
    "pods",
    db.pods,
    companyId,
    id,
    expectedVersion,
    (current) => {
      const next = { ...current, ...fields };
      if (!next.receivedAt && next.documentUrls.length) next.receivedAt = now();
      return next;
    },
    "POD",
  );
  syncLrStampsForPod(saved);
  return saved;
}

/** Cancelling a POD also clears the LR's delivery date (it was recorded by mistake). */
export async function cancelPod(companyId: string, id: string): Promise<Pod> {
  await assertCan(companyId, "record.cancel");
  if (onDatabase()) return dbp.cancelPod(companyId, id);
  const pod = cancelRecord("pods", db.pods, companyId, id, "POD");
  setLrDelivered(companyId, pod.lrId, null);
  syncLrStampsForPod(pod);
  return pod;
}

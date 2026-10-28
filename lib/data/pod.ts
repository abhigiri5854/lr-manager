import { daysBetween } from "@/lib/fy";
import type { Page, Pod, PodPendingRow } from "@/lib/types";
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
} from "./_store";
import { ConflictError } from "./errors";

const podPatchSchema = podFields.omit({ lrId: true }).partial();
export type PodPatch = Partial<Omit<PodInput, "lrId">>;

/** "2026-10-20" → stored on Lr.deliveredAt as that UTC date. */
const deliveredAtFrom = (date: string) => `${date}T00:00:00.000Z`;

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

/** LRs of the company that are delivered and still waiting for the signed POD. */
export async function listPodPending(companyId: string): Promise<PodPendingRow[]> {
  const company = db.companies.find((c) => c.id === companyId);
  const received = new Set(
    scoped(db.pods, companyId)
      .filter((p) => p.receivedAt)
      .map((p) => p.lrId),
  );
  return scoped(db.lrs, companyId)
    .filter((lr) => lr.deliveredAt && !received.has(lr.id))
    .map((lr) => {
      const days = daysBetween(lr.deliveredAt!, today());
      const late = company?.podDays != null ? Math.max(0, days - company.podDays) : 0;
      return {
        lrId: lr.id,
        lrNo: lr.lrNo,
        deliveredOn: lr.deliveredAt!.slice(0, 10),
        consignee: db.parties.find((p) => p.id === lr.consigneeId)?.name ?? "",
        daysSinceDelivery: days,
        penaltyPaise: late * (company?.podPenaltyPerDay ?? 0),
      };
    })
    .sort((a, b) => b.daysSinceDelivery - a.daysSinceDelivery);
}

export async function listPods(companyId: string, params: ListParams = {}): Promise<Page<Pod>> {
  const lrNo = (id: string) => db.lrs.find((l) => l.id === id)?.lrNo;
  const rows = scoped(db.pods, companyId)
    .filter((p) => matchesSearch(params.search, lrNo(p.lrId), p.receivedBy, p.receiverPhone))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(clone);
  return paginate(rows, params);
}

export async function getPodById(companyId: string, id: string): Promise<Pod | null> {
  const p = findById(db.pods, companyId, id);
  return p ? clone(p) : null;
}

export async function getPodByLrId(companyId: string, lrId: string): Promise<Pod | null> {
  const p = scoped(db.pods, companyId).find((x) => x.lrId === lrId);
  return p ? clone(p) : null;
}

/** POD screen save: records delivery (marks the LR Delivered) and any signed copy received. */
export async function createPod(companyId: string, input: PodInput): Promise<Pod> {
  const v = parseInput(podFields, input);
  const lr = findById(db.lrs, companyId, v.lrId);
  if (!lr || lr.cancelledAt) fail("lrId", "LR not found in this company");
  if (!lr.bookedAt) fail("lrId", "Book the LR before recording delivery");
  if (scoped(db.pods, companyId).some((p) => p.lrId === v.lrId)) {
    fail("lrId", "This LR already has a POD — edit it instead");
  }
  if (lr.lrDate && v.deliveredOn < lr.lrDate) fail("deliveredOn", "Delivered before the LR date");

  setLrDelivered(companyId, v.lrId, deliveredAtFrom(v.deliveredOn));
  const documentUrls = v.documentUrls ?? [];
  const t = now();
  const pod: Pod = {
    id: newId(),
    companyId,
    createdAt: t,
    updatedAt: t,
    version: 1,
    lrId: v.lrId,
    receivedBy: v.receivedBy ?? null,
    receiverPhone: v.receiverPhone ?? null,
    packagesReceived: v.packagesReceived ?? null,
    condition: v.condition ?? "good",
    remarks: v.remarks ?? null,
    documentUrls,
    receivedAt: v.receivedAt ?? (documentUrls.length ? t : null),
  };
  return insertRecord("pods", db.pods, pod);
}

export async function updatePod(
  companyId: string,
  id: string,
  expectedVersion: number,
  patch: PodPatch,
): Promise<Pod> {
  const p = parseInput(podPatchSchema, patch);
  const { deliveredOn, ...fields } = p;
  // Check the POD first so a conflict can't leave the LR half-updated (one transaction in Postgres).
  const existing = getOrThrow(db.pods, companyId, id, "POD");
  if (existing.cancelledAt) fail("", "This POD is cancelled and can't be changed");
  if (existing.version !== expectedVersion) throw new ConflictError();
  if (deliveredOn) setLrDelivered(companyId, existing.lrId, deliveredAtFrom(deliveredOn));
  return updateRecord(
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
}

/** Cancelling a POD also clears the LR's delivery date (it was recorded by mistake). */
export async function cancelPod(companyId: string, id: string): Promise<Pod> {
  const pod = cancelRecord("pods", db.pods, companyId, id, "POD");
  setLrDelivered(companyId, pod.lrId, null);
  return pod;
}

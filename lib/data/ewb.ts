import { ewbBucket, ewbTimeLeft, type EwbBucket } from "@/lib/hire/ewb-expiry";
import type { EwbWhen } from "@/lib/validators/ewb-list";
import type { Page } from "@/lib/types";
import { listEwbLines, listOpenEwbTasks, type EwbLine, type EwbTask } from "./db/ewb";
import { assertCan } from "./session";

// E-way checklist reads: freight.view (RLS also limits tasks to office users).

export type EwbRow = EwbLine & {
  bucket: EwbBucket | null;
  /** "5 h 20 m", "expired 1 h ago"; null when there is no expiry */
  timeLeft: string | null;
};

const PAGE_SIZE = 50;

function matches(when: EwbWhen, bucket: EwbBucket | null): boolean {
  if (when === "all") return true;
  if (!bucket) return false;
  if (when === "expired") return bucket === "expired";
  if (when === "6h") return bucket === "under6h";
  return bucket === "under6h" || bucket === "under24h";
}

/** Every e-way bill on live challans for the filter, soonest expiry first (no-expiry rows last). */
export async function listEwbRows(companyId: string, when: EwbWhen, now = new Date()): Promise<EwbRow[]> {
  await assertCan(companyId, "freight.view");
  const lines = await listEwbLines(companyId);
  return lines
    .map(
      (l): EwbRow => ({
        ...l,
        bucket: l.validUpto ? ewbBucket(l.validUpto, now) : null,
        timeLeft: l.validUpto ? ewbTimeLeft(l.validUpto, now).label : null,
      }),
    )
    .filter((r) => matches(when, r.bucket));
}

export async function getEwbRegister(companyId: string, when: EwbWhen, page: number): Promise<Page<EwbRow>> {
  const all = await listEwbRows(companyId, when);
  const start = (page - 1) * PAGE_SIZE;
  return { rows: all.slice(start, start + PAGE_SIZE), total: all.length, page, pageSize: PAGE_SIZE };
}

export async function getOpenEwbTasks(companyId: string, challanId?: string): Promise<EwbTask[]> {
  await assertCan(companyId, "freight.view");
  return listOpenEwbTasks(companyId, challanId);
}

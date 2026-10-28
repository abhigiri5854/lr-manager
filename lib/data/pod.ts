import { mockPodPending } from "@/lib/mock/pod";
import type { PodPendingRow } from "@/lib/types";

/** LRs of the active company that are delivered and still waiting for POD. */
export async function listPodPending(): Promise<PodPendingRow[]> {
  return mockPodPending;
}

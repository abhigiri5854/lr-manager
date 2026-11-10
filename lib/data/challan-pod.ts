// POD settlement (TIER1-MARKET-TRUCKS.md §6 screen 3, T1-07). Database only, like challans: the mock
// store has no challans, so under unit tests every write stops after its permission check.
// Payments are OPTIONAL (owner decision): nothing here requires one.
//
// Permissions: recording the POD = pod.upload (it writes the LRs' PODs too); POD charges and
// settling = bill.edit (money to the truck / party); removing a charge or reopening a settled
// challan = record.cancel. RLS + triggers enforce the same on the database.
import type { ChallanSettlement, ChallanSettlementState } from "@/lib/types";
import {
  challanPodChargesFields,
  challanPodFields,
  reopenChallanFields,
  type ChallanPodChargesInput,
  type ChallanPodInput,
  type ReopenChallanInput,
} from "@/lib/validators/challan-pod";
import { fail, parseInput } from "./_store";
import * as dbs from "./db/challan-pod";
import { assertCan } from "./session";
import { onDatabase } from "./source";

const DB_ONLY = "POD settlement needs the database";

export const getChallanSettlement = (
  companyId: string,
  id: string,
): Promise<ChallanSettlement | null> =>
  onDatabase() ? dbs.getChallanSettlement(companyId, id) : Promise.resolve(null);

/** Dates, delivered packages per LR and POD files; also writes each LR's POD (same transaction). */
export async function recordChallanPod(
  companyId: string,
  id: string,
  expectedVersion: number,
  input: ChallanPodInput,
): Promise<ChallanSettlement> {
  const role = await assertCan(companyId, "pod.upload");
  const v = parseInput(challanPodFields, input);
  if (!onDatabase()) fail("", DB_ONLY);
  return dbs.recordChallanPod(companyId, id, expectedVersion, v, role);
}

/** Manual POD-stage charges (add / deduct, optional party amount) and the late-POD fee override. */
export async function saveChallanPodCharges(
  companyId: string,
  id: string,
  expectedVersion: number,
  input: ChallanPodChargesInput,
): Promise<ChallanSettlement> {
  await assertCan(companyId, "bill.edit");
  const v = parseInput(challanPodChargesFields, input);
  if (v.remove.length) await assertCan(companyId, "record.cancel");
  if (!onDatabase()) fail("", DB_ONLY);
  return dbs.saveChallanPodCharges(companyId, id, expectedVersion, v);
}

/** pod_received → settled (no payment needed). */
export async function settleChallan(
  companyId: string,
  id: string,
  expectedVersion: number,
): Promise<ChallanSettlementState> {
  await assertCan(companyId, "bill.edit");
  if (!onDatabase()) fail("", DB_ONLY);
  return dbs.settleChallan(companyId, id, expectedVersion);
}

/** settled → pod_received; needs record.cancel and a reason (kept on the challan + audit_log). */
export async function reopenChallan(
  companyId: string,
  id: string,
  expectedVersion: number,
  input: ReopenChallanInput,
): Promise<ChallanSettlementState> {
  await assertCan(companyId, "record.cancel");
  const { reason } = parseInput(reopenChallanFields, input);
  if (!onDatabase()) fail("", DB_ONLY);
  return dbs.reopenChallan(companyId, id, expectedVersion, reason);
}

// Who belongs to a company and with which role (Users & roles). Changing roles or removing
// someone needs "company.manage" (Owner), and a company always keeps at least one Owner.
import type { Membership, Role } from "@/lib/types";
import { roleSchema } from "@/lib/validators/common";
import {
  cancelRecord,
  clone,
  db,
  fail,
  getOrThrow,
  parseInput,
  scoped,
  updateRecord,
} from "./_store";
import { assertCan } from "./session";

export const LAST_OWNER_MESSAGE =
  "A company needs at least one Owner — make someone else Owner first.";

export async function listMembers(companyId: string): Promise<Membership[]> {
  return scoped(db.memberships, companyId).map(clone);
}

/**
 * Fails when the change would leave the company without an active Owner.
 * nextRole null = the member is being removed.
 */
function assertKeepsOwner(companyId: string, membershipId: string, nextRole: Role | null): void {
  const owners = scoped(db.memberships, companyId).filter((m) => m.role === "owner");
  const losing = owners.some((m) => m.id === membershipId) && nextRole !== "owner";
  if (losing && owners.length <= 1) fail("role", LAST_OWNER_MESSAGE);
}

export async function changeMemberRole(
  companyId: string,
  membershipId: string,
  expectedVersion: number,
  role: Role,
): Promise<Membership> {
  await assertCan(companyId, "company.manage");
  const next = parseInput(roleSchema, role);
  getOrThrow(db.memberships, companyId, membershipId, "Member");
  assertKeepsOwner(companyId, membershipId, next);
  return updateRecord(
    "memberships",
    db.memberships,
    companyId,
    membershipId,
    expectedVersion,
    (current) => ({ ...current, role: next }),
    "Member",
  );
}

/** Takes someone out of the company (soft: cancelledAt). Their records and audit rows stay. */
export async function removeMember(companyId: string, membershipId: string): Promise<Membership> {
  await assertCan(companyId, "company.manage");
  assertKeepsOwner(companyId, membershipId, null);
  return cancelRecord("memberships", db.memberships, companyId, membershipId, "Member");
}

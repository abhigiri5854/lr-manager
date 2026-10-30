// Who belongs to a company and with which role (Users & roles). Changing roles or removing
// someone needs "company.manage" (Owner), and a company always keeps at least one Owner.
import { randomInt } from "node:crypto";
import type { IsoDateTime, Membership, Role, User } from "@/lib/types";
import { roleSchema } from "@/lib/validators/common";
import { inviteMemberSchema, type InviteMemberInput } from "@/lib/validators/member";
import {
  hashPassword,
  insertRecord,
  newId,
  now,
  writeAudit,
  cancelRecord,
  clone,
  db,
  fail,
  getOrThrow,
  parseInput,
  scoped,
  updateRecord,
  authorStamp,
} from "./_store";
import { ForbiddenError } from "./errors";
import * as dbm from "./db/members";
import { assertCan, getCurrentUserId, getRole } from "./session";
import { onDatabase } from "./source";

export const LAST_OWNER_MESSAGE =
  "A company needs at least one Owner — make someone else Owner first.";

export async function listMembers(companyId: string): Promise<Membership[]> {
  if (onDatabase()) return dbm.listMembers(companyId);
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
  if (onDatabase()) return dbm.changeMemberRole(companyId, membershipId, expectedVersion, next);
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
  if (onDatabase()) return dbm.removeMember(companyId, membershipId);
  assertKeepsOwner(companyId, membershipId, null);
  return cancelRecord("memberships", db.memberships, companyId, membershipId, "Member");
}

/** One row of the Users & roles table. */
export type MemberRow = {
  membershipId: string;
  version: number;
  userId: string;
  name: string;
  mobile: string | null;
  email: string | null;
  role: Role;
  lastLoginAt: IsoDateTime | null;
  isMe: boolean;
};

const ROLE_ORDER: Record<Role, number> = { owner: 0, accountant: 1, booking_staff: 2, driver: 3 };

/** Everyone in the company (any member may look; changing needs company.manage). */
export async function listMemberRows(companyId: string): Promise<MemberRow[]> {
  if (!(await getRole(companyId))) throw new ForbiddenError("You're not a member of this company.");
  const me = await getCurrentUserId();
  if (onDatabase()) {
    return (await dbm.listMemberRows(companyId))
      .map((r) => ({ ...r, isMe: r.userId === me }))
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
  }
  return scoped(db.memberships, companyId)
    .map((m) => {
      const u = db.users.find((x) => x.id === m.userId)!;
      return {
        membershipId: m.id,
        version: m.version,
        userId: u.id,
        name: u.name,
        mobile: u.mobile,
        email: u.email,
        role: m.role,
        lastLoginAt: u.lastLoginAt,
        isMe: u.id === me,
      };
    })
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
}

// Readable one-time passwords: no 0/O or 1/l/I.
const PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
function tempPassword(): string {
  return Array.from({ length: 10 }, () => PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]).join(
    "",
  );
}

/**
 * "+ Invite user": adds a person to this company with an office role. A login belongs to one
 * company only, so the person always gets a new login here (the same mobile can have one in
 * another company) with a one-time password to pass on. Someone already in this company is
 * refused; someone removed earlier is added back with their old login.
 */
export async function inviteMember(
  companyId: string,
  input: InviteMemberInput,
): Promise<{ membership: Membership; tempPassword: string | null }> {
  await assertCan(companyId, "company.manage");
  const v = parseInput(inviteMemberSchema, input);
  if (onDatabase()) return dbm.inviteMember(companyId, v, tempPassword);
  const t = now();
  const inThisCompany = db.users.find(
    (u) =>
      !u.cancelledAt &&
      db.memberships.some((m) => m.userId === u.id && m.companyId === companyId) &&
      (u.mobile === v.mobile || (v.email != null && u.email === v.email)),
  );
  let user = inThisCompany;
  let password: string | null = null;
  if (user) {
    if (
      db.memberships.some(
        (m) => m.userId === user!.id && m.companyId === companyId && !m.cancelledAt,
      )
    ) {
      fail("mobile", `${user.name} is already in this company — use Edit to change their role.`);
    }
  } else {
    const created: User = {
      id: newId(),
      createdAt: t,
      updatedAt: t,
      name: v.name,
      mobile: v.mobile,
      email: v.email ?? null,
      lastLoginAt: null,
    };
    db.users.push(created);
    writeAudit(companyId, "users", created.id, "create", null, created);
    password = tempPassword();
    db.credentials.push(hashPassword(created.id, password));
    user = created;
  }
  const membership = insertRecord("memberships", db.memberships, {
    id: newId(),
    companyId,
    userId: user.id,
    role: v.role,
    createdAt: t,
    updatedAt: t,
    version: 1,
    ...authorStamp(),
  });
  return { membership, tempPassword: password };
}

/**
 * Owner sets a new one-time password for a member (mock "Forgot password?"). Only for people
 * of the Owner's own company.
 */
export async function resetMemberPassword(
  companyId: string,
  membershipId: string,
): Promise<{ tempPassword: string }> {
  await assertCan(companyId, "company.manage");
  if (onDatabase()) return dbm.resetMemberPassword(companyId, membershipId, tempPassword);
  const m = getOrThrow(db.memberships, companyId, membershipId, "Member");
  if (m.cancelledAt) fail("", "This person is no longer in the company");
  const password = tempPassword();
  db.credentials = db.credentials.filter((c) => c.userId !== m.userId);
  db.credentials.push(hashPassword(m.userId, password));
  return { tempPassword: password };
}

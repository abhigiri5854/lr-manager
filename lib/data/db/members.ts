// Users & roles on the database (DATA_SOURCE=db). Same behaviour as the mock half of
// ../members.ts. New people are created in Supabase Auth (secret key, server only); the
// public.users row comes from the auth.users trigger. Permission is checked in ../members.ts.
import { ensureAuthUser, setAuthPassword } from "@/db/auth-admin";
import type { Membership, Role } from "@/lib/types";
import type { z } from "zod";
import type { inviteMemberSchema } from "@/lib/validators/member";
import { fail, newId } from "../_store";
import { withUser, type Tx } from "./conn";
import { audit, toMembership, toUser } from "./rows";
import { cancelRow, lockForUpdate, lockRow, updateVersioned } from "./write";
import { LAST_OWNER_MESSAGE, type MemberRow } from "../members";

export async function listMembers(companyId: string): Promise<Membership[]> {
  return withUser(async (tx) => {
    const rows = await tx`select * from memberships
                           where company_id = ${companyId} and cancelled_at is null
                           order by created_at, id`;
    return rows.map(toMembership);
  });
}

async function assertKeepsOwner(
  tx: Tx,
  companyId: string,
  membershipId: string,
  nextRole: Role | null,
) {
  const owners = await tx`select id from memberships
                           where company_id = ${companyId} and role = 'owner' and cancelled_at is null`;
  const losing = owners.some((m) => m.id === membershipId) && nextRole !== "owner";
  if (losing && owners.length <= 1) fail("role", LAST_OWNER_MESSAGE);
}

export async function changeMemberRole(
  companyId: string,
  membershipId: string,
  expectedVersion: number,
  role: Role,
): Promise<Membership> {
  return withUser(async (tx) => {
    const current = toMembership(
      await lockForUpdate(tx, "memberships", companyId, membershipId, expectedVersion, "Member"),
    );
    await assertKeepsOwner(tx, companyId, membershipId, role);
    const saved = toMembership(
      await updateVersioned(tx, "memberships", companyId, membershipId, expectedVersion, { role }),
    );
    await audit(tx, companyId, "memberships", membershipId, "update", current, saved);
    return saved;
  });
}

export async function removeMember(companyId: string, membershipId: string): Promise<Membership> {
  return withUser(async (tx) => {
    await lockRow(tx, "memberships", companyId, membershipId, "Member");
    await assertKeepsOwner(tx, companyId, membershipId, null);
    const { before, after, changed } = await cancelRow(
      tx,
      "memberships",
      companyId,
      membershipId,
      "Member",
    );
    const saved = toMembership(after);
    if (changed)
      await audit(
        tx,
        companyId,
        "memberships",
        membershipId,
        "cancel",
        toMembership(before),
        saved,
      );
    return saved;
  });
}

/** Rows for the table; ../members.ts sorts them and checks the viewer is a member. */
export async function listMemberRows(companyId: string): Promise<Omit<MemberRow, "isMe">[]> {
  return withUser(async (tx) => {
    const rows = await tx`
      select m.id as membership_id, m.version, m.role, u.id as user_id, u.name, u.mobile, u.email,
             u.last_login_at,
             coalesce((select array_agg(c.label order by x.created_at, x.id)
                         from memberships x
                         join companies c on c.id = x.company_id and c.cancelled_at is null
                        where x.user_id = m.user_id and x.cancelled_at is null
                          and exists (select 1 from memberships me
                                       where me.user_id = auth.uid() and me.company_id = x.company_id
                                         and me.cancelled_at is null)), '{}') as companies
        from memberships m
        join users u on u.id = m.user_id
       where m.company_id = ${companyId} and m.cancelled_at is null`;
    return rows.map((r) => ({
      membershipId: r.membership_id,
      version: r.version,
      userId: r.user_id,
      name: r.name,
      mobile: r.mobile,
      email: r.email,
      role: r.role,
      companies: r.companies,
      lastLoginAt: r.last_login_at,
    }));
  });
}

/** E-mail Supabase Auth gets for someone invited by mobile only. */
const placeholderEmail = (mobile: string) => `mobile-${mobile}@example.com`;

export async function inviteMember(
  companyId: string,
  v: z.output<typeof inviteMemberSchema>,
  tempPassword: () => string,
): Promise<{ membership: Membership; tempPassword: string | null }> {
  return withUser(async (tx) => {
    const [found] = await tx`select app.find_user(${v.mobile}, ${v.email ?? null}) as id`;
    let userId = found.id as string | null;
    let password: string | null = null;
    if (userId) {
      const [already] = await tx`
        select u.name from memberships m join users u on u.id = m.user_id
         where m.company_id = ${companyId} and m.user_id = ${userId} and m.cancelled_at is null`;
      if (already) {
        fail(
          "mobile",
          `${already.name} is already in this company — use Edit to change their role.`,
        );
      }
    } else {
      userId = newId();
      password = tempPassword();
      await ensureAuthUser({
        id: userId,
        email: v.email ?? placeholderEmail(v.mobile),
        emailPlaceholder: !v.email,
        password,
        name: v.name,
        mobile: v.mobile,
      });
    }
    const [m] =
      await tx`insert into memberships ${tx({ company_id: companyId, user_id: userId, role: v.role })}
                         returning *`;
    const membership = toMembership(m);
    if (password) {
      // Visible now that they share this company.
      const [u] = await tx`select * from users where id = ${userId}`;
      await audit(tx, companyId, "users", userId, "create", null, toUser(u));
    }
    await audit(tx, companyId, "memberships", membership.id, "create", null, membership);
    return { membership, tempPassword: password };
  });
}

export async function resetMemberPassword(
  companyId: string,
  membershipId: string,
  tempPassword: () => string,
): Promise<{ tempPassword: string }> {
  const userId = await withUser(async (tx) => {
    const m = toMembership(await lockRow(tx, "memberships", companyId, membershipId, "Member"));
    if (m.cancelledAt) fail("", "This person is no longer in the company");
    const [ok] = await tx`select app.can_reset_password(${m.userId}) as ok`;
    if (!ok.ok) fail("", "They also work for a company you don't own — ask that company's Owner.");
    return m.userId;
  });
  const password = tempPassword();
  await setAuthPassword(userId, password);
  return { tempPassword: password };
}

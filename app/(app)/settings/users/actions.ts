"use server";

import { refresh } from "next/cache";
import { toActionFailure, type ActionFailure } from "@/lib/data/errors";
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  resetMemberPassword,
} from "@/lib/data/members";
import { getActiveCompanyId } from "@/lib/data/session";
import type { Role } from "@/lib/types";
import type { InviteMemberInput } from "@/lib/validators/member";

// Users & roles. Who may do what is checked in lib/data (company.manage = Owner).

export async function inviteMemberAction(
  input: InviteMemberInput,
): Promise<{ ok: true; tempPassword: string | null } | ActionFailure> {
  try {
    const r = await inviteMember(await getActiveCompanyId(), input);
    refresh();
    return { ok: true, tempPassword: r.tempPassword };
  } catch (e) {
    return toActionFailure(e);
  }
}

export async function changeRoleAction(
  membershipId: string,
  expectedVersion: number,
  role: Role,
): Promise<{ ok: true } | ActionFailure> {
  try {
    await changeMemberRole(await getActiveCompanyId(), membershipId, expectedVersion, role);
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionFailure(e);
  }
}

export async function removeMemberAction(
  membershipId: string,
): Promise<{ ok: true } | ActionFailure> {
  try {
    await removeMember(await getActiveCompanyId(), membershipId);
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionFailure(e);
  }
}

export async function resetPasswordAction(
  membershipId: string,
): Promise<{ ok: true; tempPassword: string } | ActionFailure> {
  try {
    const r = await resetMemberPassword(await getActiveCompanyId(), membershipId);
    return { ok: true, tempPassword: r.tempPassword };
  } catch (e) {
    return toActionFailure(e);
  }
}

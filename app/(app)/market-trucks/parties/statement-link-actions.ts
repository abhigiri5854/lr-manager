"use server";

// Owner-side statement-link actions for a truck party. Roles are checked in lib/data/party-statements
// (master.edit to send / revoke, freight.view for the status).
import { revalidatePath } from "next/cache";
import {
  getOrCreatePartyStatementLink,
  getPartyStatementLinkStatus,
  revokePartyStatementLink,
  type PartyStatementLinkStatus,
} from "@/lib/data/party-statements";
import { getActiveCompanyId } from "@/lib/data/session";
import { toFailure, type ActionFailure } from "../failure";

function failure(e: unknown): ActionFailure {
  try {
    return toFailure(e);
  } catch {
    console.error("statement-link action failed", e);
    const msg = e instanceof Error ? e.message : "";
    const setup = /APP_BASE_URL|secret|DRIVER_LINK|database/i.test(msg);
    return {
      ok: false,
      kind: "error",
      message: setup ? "Statement link is not set up – contact admin" : "Something went wrong. Please try again.",
    };
  }
}

const profilePath = (partyId: string) => `/market-trucks/parties/${partyId}`;

export async function getStatementLinkAction(partyId: string): Promise<{ ok: true; url: string } | ActionFailure> {
  try {
    const companyId = await getActiveCompanyId();
    const link = await getOrCreatePartyStatementLink(companyId, partyId);
    revalidatePath(profilePath(partyId));
    return { ok: true, url: link.url };
  } catch (e) {
    return failure(e);
  }
}

export async function revokeStatementLinkAction(
  partyId: string,
): Promise<{ ok: true; revoked: boolean } | ActionFailure> {
  try {
    const companyId = await getActiveCompanyId();
    const r = await revokePartyStatementLink(companyId, partyId);
    revalidatePath(profilePath(partyId));
    return { ok: true, revoked: r.revoked };
  } catch (e) {
    return failure(e);
  }
}

export async function statementLinkStatusAction(
  partyId: string,
): Promise<{ ok: true; status: PartyStatementLinkStatus | null } | ActionFailure> {
  try {
    const companyId = await getActiveCompanyId();
    return { ok: true, status: await getPartyStatementLinkStatus(companyId, partyId) };
  } catch (e) {
    return failure(e);
  }
}

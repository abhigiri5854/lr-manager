import { connection } from "next/server";
import { DEFAULT_SESSION } from "./_store";

// Until Supabase Auth is wired up (Phase 4), everyone works as the owner of ACM Logistics.
// Both functions wait for the request (later they read the auth cookie), so any page
// that loads data through them renders per request instead of being prerendered.

/** The company chosen in "Working as". */
export async function getActiveCompanyId(): Promise<string> {
  await connection();
  return DEFAULT_SESSION.companyId;
}

export async function getCurrentUserId(): Promise<string> {
  await connection();
  return DEFAULT_SESSION.userId;
}

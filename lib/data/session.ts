import { DEFAULT_SESSION } from "./_store";

// Until Supabase Auth is wired up (Phase 4), everyone works as the owner of ACM Logistics.

/** The company chosen in "Working as". */
export async function getActiveCompanyId(): Promise<string> {
  return DEFAULT_SESSION.companyId;
}

export async function getCurrentUserId(): Promise<string> {
  return DEFAULT_SESSION.userId;
}

"use server";

import { refresh } from "next/cache";
import { setActiveCompany } from "@/lib/data/session";

/** Sidebar "Working as": every page re-renders for the chosen company. */
export async function switchCompanyAction(companyId: string): Promise<void> {
  await setActiveCompany(companyId);
  refresh();
}

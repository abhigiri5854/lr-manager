import { mockCompanies } from "@/lib/mock/companies";
import type { Company } from "@/lib/types";

/** Companies the current user can work as. */
export async function listCompanies(): Promise<Company[]> {
  return mockCompanies;
}

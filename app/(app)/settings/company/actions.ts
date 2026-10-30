"use server";

import { updateCompany } from "@/lib/data/companies";
import { toActionFailure, type ActionFailure } from "@/lib/data/errors";
import { getActiveCompanyId } from "@/lib/data/session";
import { uploadCompanyImage } from "@/lib/data/uploads";
import type { Company } from "@/lib/types";
import type { CompanyPatch } from "@/lib/validators/company";

const SWITCHED: ActionFailure = {
  ok: false,
  kind: "conflict",
  message: "This page is for a different company — reload before saving.",
};

/** Saves the Company profile of the company chosen in "Working as". */
export async function saveCompanyAction(
  companyId: string,
  expectedVersion: number,
  patch: CompanyPatch,
): Promise<{ ok: true; company: Company } | ActionFailure> {
  if (companyId !== (await getActiveCompanyId())) return SWITCHED;
  try {
    // The saved profile goes back to the form; the form refreshes the page in the background.
    return { ok: true, company: await updateCompany(companyId, expectedVersion, patch) };
  } catch (e) {
    return toActionFailure(e);
  }
}

/** Uploads a logo or signature; the returned URL is saved with the profile on "Save changes". */
export async function uploadCompanyImageAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | ActionFailure> {
  const companyId = String(formData.get("companyId") ?? "");
  const kind = formData.get("kind") === "signature" ? "signature" : "logo";
  const file = formData.get("file");
  if (companyId !== (await getActiveCompanyId())) return SWITCHED;
  if (!(file instanceof File)) {
    return { ok: false, kind: "error", message: "Choose a file to upload" };
  }
  try {
    const { url } = await uploadCompanyImage(companyId, kind, {
      name: file.name,
      type: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return { ok: true, url };
  } catch (e) {
    return toActionFailure(e);
  }
}

"use server";

// Server action for the POD screen. Role checks happen in lib/data (lib/permissions.ts).
import { refresh } from "next/cache";
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from "@/lib/data/errors";
import { createPod, getPodByLrId, updatePod } from "@/lib/data/pod";
import { getActiveCompanyId } from "@/lib/data/session";
import { uploadPodFile } from "@/lib/data/uploads";
import type { RuleError } from "@/lib/validators/common";

export type SavePodResult =
  | { ok: true; version: number; received: boolean }
  | { ok: false; kind: "validation"; issues: RuleError[]; message: string }
  | { ok: false; kind: "conflict"; message: string }
  | { ok: false; kind: "error"; message: string };

type Fields = {
  deliveredOn: string;
  receivedBy: string;
  receiverPhone: string;
  packagesReceived: string;
  condition: "good" | "short" | "damaged";
  remarks: string;
};

/**
 * Uploads one signed copy (FormData "file"). One file per request keeps each under the
 * 3 MB server-action limit; the form then saves the returned URL with the POD.
 */
export async function uploadPodFileAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const companyId = await getActiveCompanyId();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "No file chosen" };
  try {
    const { url } = await uploadPodFile(companyId, {
      name: file.name,
      type: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return { ok: true, url };
  } catch (e) {
    if (e instanceof ValidationError || e instanceof ForbiddenError)
      return { ok: false, message: e.message };
    throw e;
  }
}

/**
 * Saves the delivery details. `keep` = URLs of the signed copies on the POD (already uploaded
 * ones that stay, plus new ones from uploadPodFileAction). No POD yet → create, else update at
 * `expectedVersion`.
 */
export async function savePodAction(formData: FormData): Promise<SavePodResult> {
  const companyId = await getActiveCompanyId();
  try {
    const lrId = String(formData.get("lrId") ?? "");
    const expectedVersion = Number(formData.get("expectedVersion") ?? "");
    const f = JSON.parse(String(formData.get("fields") ?? "{}")) as Fields;
    const keep = formData.getAll("keep").map(String);

    const packages = f.packagesReceived.trim();
    const common = {
      deliveredOn: f.deliveredOn,
      receivedBy: f.receivedBy,
      receiverPhone: f.receiverPhone,
      packagesReceived: packages === "" ? undefined : Number(packages),
      condition: f.condition,
      remarks: f.remarks,
      documentUrls: keep,
    };

    const existing = await getPodByLrId(companyId, lrId);
    const pod = existing
      ? await updatePod(companyId, existing.id, expectedVersion, common)
      : await createPod(companyId, { lrId, ...common });
    refresh();
    return { ok: true, version: pod.version, received: pod.receivedAt !== null };
  } catch (e) {
    if (e instanceof ValidationError)
      return { ok: false, kind: "validation", issues: e.issues, message: e.message };
    if (e instanceof ConflictError) return { ok: false, kind: "conflict", message: e.message };
    if (e instanceof NotFoundError || e instanceof ForbiddenError)
      return { ok: false, kind: "error", message: e.message };
    throw e;
  }
}

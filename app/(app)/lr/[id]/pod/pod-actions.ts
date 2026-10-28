"use server";

// Server action for the POD screen. Role checks come with auth (Phase 4).
import { refresh } from "next/cache";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/data/errors";
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
 * Saves the delivery details and any newly added signed copies (FormData "files").
 * `keep` = URLs of already uploaded copies that stay. No POD yet → create, else update at
 * `expectedVersion`.
 */
export async function savePodAction(formData: FormData): Promise<SavePodResult> {
  const companyId = await getActiveCompanyId();
  try {
    const lrId = String(formData.get("lrId") ?? "");
    const expectedVersion = Number(formData.get("expectedVersion") ?? "");
    const f = JSON.parse(String(formData.get("fields") ?? "{}")) as Fields;
    const keep = formData.getAll("keep").map(String);

    const uploaded: string[] = [];
    for (const file of formData.getAll("files")) {
      if (!(file instanceof File) || file.size === 0) continue;
      const { url } = await uploadPodFile(companyId, {
        name: file.name,
        type: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      uploaded.push(url);
    }

    const packages = f.packagesReceived.trim();
    const common = {
      deliveredOn: f.deliveredOn,
      receivedBy: f.receivedBy,
      receiverPhone: f.receiverPhone,
      packagesReceived: packages === "" ? undefined : Number(packages),
      condition: f.condition,
      remarks: f.remarks,
      documentUrls: [...keep, ...uploaded],
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
    if (e instanceof NotFoundError) return { ok: false, kind: "error", message: e.message };
    throw e;
  }
}

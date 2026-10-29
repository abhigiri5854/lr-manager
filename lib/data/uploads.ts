import { UPLOAD_MAX_BYTES } from "@/lib/image-upload";
import { IMPORT_MAX_BYTES, type ImportFormat } from "@/lib/import/file-types";
import { fail, newId } from "./_store";
import { ForbiddenError } from "./errors";
import { withUserRead } from "./db/conn";
import {
  importObjectPath,
  importUrlFromPath,
  objectPath,
  podObjectPath,
  podUrlFromPath,
  putObject,
  safeName,
  urlFromPath,
} from "./db/storage";
import { assertCan } from "./session";
import { onDatabase } from "./source";

// Uploaded files (signed LR copies, company logos and signatures). The mock keeps them in memory; when Supabase Storage is
// wired up only this file changes — callers just get back a URL to store on the record.

type Stored = { companyId: string; name: string; type: string; bytes: Uint8Array };

const globalStore = globalThis as typeof globalThis & { __lrManagerUploads?: Map<string, Stored> };
const files = (globalStore.__lrManagerUploads ??= new Map<string, Stored>());

/** One file per request; matches the 3 MB server-action limit. Photos are shrunk in the browser first. */
export const MAX_UPLOAD_BYTES = UPLOAD_MAX_BYTES;
const allowed = (type: string) => type.startsWith("image/") || type === "application/pdf";

/**
 * Stores one photo / PDF and returns the URL to keep on the record. On the database the file goes
 * to the private `pod` bucket under the LR (so a driver's own-trip rule applies), hence `lrId`.
 */
export async function uploadPodFile(
  companyId: string,
  file: { name: string; type: string; bytes: Uint8Array },
  lrId?: string,
): Promise<{ url: string; name: string }> {
  await assertCan(companyId, "pod.upload", "pod.upload_own");
  if (!allowed(file.type))
    fail("documentUrls", `${file.name}: only photos and PDFs can be uploaded`);
  if (file.bytes.byteLength === 0) fail("documentUrls", `${file.name}: the file is empty`);
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES)
    fail("documentUrls", `${file.name}: larger than 3 MB`);
  const id = newId();
  if (onDatabase()) {
    if (!lrId || !isUuid(lrId)) fail("documentUrls", "Open the LR's POD screen to add a copy");
    // Same rule as saving the POD: office roles on any LR, a driver on their own trip.
    const mayRecord = await withUserRead(
      async (tx) => (await tx`select 1 from app.lr_pod_info(${companyId}, ${lrId})`).length > 0,
    );
    if (!mayRecord) throw new ForbiddenError("You can only add POD copies to LRs you may record POD for.");
    const name = safeName(file.name, "signed-copy");
    const path = podObjectPath(companyId, lrId, id, name);
    await putObject("pod", path, file);
    return { url: podUrlFromPath(path), name };
  }
  const name = file.name.slice(0, 100) || "signed-copy";
  files.set(id, { companyId, name, type: file.type, bytes: file.bytes });
  return { url: `/uploads/${id}?n=${encodeURIComponent(name)}`, name };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID.test(s);

/** May the signed-in user open the POD copies of this LR? Office roles, or a driver on their trip. */
export async function canReadPodFile(companyId: string, lrId: string): Promise<boolean> {
  if (!isUuid(lrId)) return false;
  return withUserRead(async (tx) => {
    const [r] = await tx`select (app.is_office(${companyId}) or app.is_own_trip(${companyId}, ${lrId})) as ok`;
    return r?.ok === true;
  });
}

/** A stored file, only for the company that uploaded it. */
export async function getUpload(companyId: string, id: string) {
  if (onDatabase()) return null;
  const f = files.get(id);
  return f && f.companyId === companyId ? f : null;
}

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const COMPANY_IMAGE_TYPES = ["image/png", "image/svg+xml", "image/jpeg"] as const;

/** Company logo or signature/stamp (PNG, SVG or JPG, up to 2 MB). Owner only. */
export async function uploadCompanyImage(
  companyId: string,
  kind: "logo" | "signature",
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<{ url: string; name: string }> {
  await assertCan(companyId, "company.manage");
  const path = kind === "logo" ? "logoUrl" : "signatureUrl";
  if (!(COMPANY_IMAGE_TYPES as readonly string[]).includes(file.type))
    fail(path, `${file.name}: use a PNG, SVG or JPG image`);
  if (file.bytes.byteLength === 0) fail(path, `${file.name}: the file is empty`);
  if (file.bytes.byteLength > MAX_IMAGE_BYTES) fail(path, `${file.name}: larger than 2 MB`);
  const id = newId();
  if (onDatabase()) {
    // Private bucket under the company's folder; the record keeps the path (lib/data/db/storage.ts).
    const bucket = kind === "logo" ? "logos" : "signatures";
    const name = safeName(file.name, kind);
    const objectKey = objectPath(bucket, companyId, id, name);
    await putObject(bucket, objectKey, file);
    return { url: urlFromPath(bucket, objectKey)!, name };
  }
  const name = file.name.slice(0, 100) || kind;
  files.set(id, { companyId, name, type: file.type, bytes: file.bytes });
  return { url: `/uploads/${id}?n=${encodeURIComponent(name)}`, name };
}

/** Content types we serve import files with (never the browser's claim). */
export const IMPORT_CONTENT_TYPE: Record<ImportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
};

/**
 * Smart import: keeps the original file (PDF, photo or workbook, up to 10 MB) so it can be
 * shown beside the Tax invoice form and downloaded later. Callers have already checked the
 * type with checkImportBytes; this is the backstop on size and role.
 */
export async function uploadImportFile(
  companyId: string,
  file: { name: string; format: ImportFormat; bytes: Uint8Array },
): Promise<{ url: string; name: string }> {
  await assertCan(companyId, "import.run");
  if (file.bytes.byteLength === 0) fail("file", `${file.name}: the file is empty`);
  if (file.bytes.byteLength > IMPORT_MAX_BYTES) fail("file", `${file.name}: larger than 10 MB`);
  const id = newId();
  if (onDatabase()) {
    // Private imports bucket under the company's folder; the batch keeps the path.
    const name = safeName(file.name, "import-file");
    const path = importObjectPath(companyId, id, name);
    await putObject("imports", path, {
      type: IMPORT_CONTENT_TYPE[file.format].split(";")[0],
      bytes: file.bytes,
    });
    return { url: importUrlFromPath(path)!, name: file.name.slice(0, 100) || name };
  }
  const name = file.name.slice(0, 100) || "import-file";
  files.set(id, {
    companyId,
    name,
    type: IMPORT_CONTENT_TYPE[file.format],
    bytes: file.bytes,
  });
  return { url: `/uploads/${id}?n=${encodeURIComponent(name)}`, name };
}

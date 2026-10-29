import { UPLOAD_MAX_BYTES } from "@/lib/image-upload";
import { IMPORT_MAX_BYTES, type ImportFormat } from "@/lib/import/file-types";
import { fail, newId } from "./_store";
import { objectPath, putObject, safeName, urlFromPath } from "./db/storage";
import { NotOnDatabaseError } from "./errors";
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

/** Stores one photo / PDF and returns the URL to keep on the record. */
export async function uploadPodFile(
  companyId: string,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<{ url: string; name: string }> {
  await assertCan(companyId, "pod.upload", "pod.upload_own");
  if (onDatabase()) throw new NotOnDatabaseError();
  if (!allowed(file.type))
    fail("documentUrls", `${file.name}: only photos and PDFs can be uploaded`);
  if (file.bytes.byteLength === 0) fail("documentUrls", `${file.name}: the file is empty`);
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES)
    fail("documentUrls", `${file.name}: larger than 3 MB`);
  const id = newId();
  const name = file.name.slice(0, 100) || "signed-copy";
  files.set(id, { companyId, name, type: file.type, bytes: file.bytes });
  return { url: `/uploads/${id}?n=${encodeURIComponent(name)}`, name };
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
  if (onDatabase()) throw new NotOnDatabaseError();
  if (file.bytes.byteLength === 0) fail("file", `${file.name}: the file is empty`);
  if (file.bytes.byteLength > IMPORT_MAX_BYTES) fail("file", `${file.name}: larger than 10 MB`);
  const id = newId();
  const name = file.name.slice(0, 100) || "import-file";
  files.set(id, {
    companyId,
    name,
    type: IMPORT_CONTENT_TYPE[file.format],
    bytes: file.bytes,
  });
  return { url: `/uploads/${id}?n=${encodeURIComponent(name)}`, name };
}

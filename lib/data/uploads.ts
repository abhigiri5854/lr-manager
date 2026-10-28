import { fail, newId } from "./_store";
import { assertOwner } from "./session";

// Uploaded files (signed LR copies, company logos and signatures). The mock keeps them in memory; when Supabase Storage is
// wired up only this file changes — callers just get back a URL to store on the record.

type Stored = { companyId: string; name: string; type: string; bytes: Uint8Array };

const globalStore = globalThis as typeof globalThis & { __lrManagerUploads?: Map<string, Stored> };
const files = (globalStore.__lrManagerUploads ??= new Map<string, Stored>());

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const allowed = (type: string) => type.startsWith("image/") || type === "application/pdf";

/** Stores one photo / PDF and returns the URL to keep on the record. */
export async function uploadPodFile(
  companyId: string,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<{ url: string; name: string }> {
  if (!allowed(file.type))
    fail("documentUrls", `${file.name}: only photos and PDFs can be uploaded`);
  if (file.bytes.byteLength === 0) fail("documentUrls", `${file.name}: the file is empty`);
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES)
    fail("documentUrls", `${file.name}: larger than 10 MB`);
  const id = newId();
  const name = file.name.slice(0, 100) || "signed-copy";
  files.set(id, { companyId, name, type: file.type, bytes: file.bytes });
  return { url: `/uploads/${id}?n=${encodeURIComponent(name)}`, name };
}

/** A stored file, only for the company that uploaded it. */
export async function getUpload(companyId: string, id: string) {
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
  await assertOwner(companyId, "change the company logo or signature");
  const path = kind === "logo" ? "logoUrl" : "signatureUrl";
  if (!(COMPANY_IMAGE_TYPES as readonly string[]).includes(file.type))
    fail(path, `${file.name}: use a PNG, SVG or JPG image`);
  if (file.bytes.byteLength === 0) fail(path, `${file.name}: the file is empty`);
  if (file.bytes.byteLength > MAX_IMAGE_BYTES) fail(path, `${file.name}: larger than 2 MB`);
  const id = newId();
  const name = file.name.slice(0, 100) || kind;
  files.set(id, { companyId, name, type: file.type, bytes: file.bytes });
  return { url: `/uploads/${id}?n=${encodeURIComponent(name)}`, name };
}

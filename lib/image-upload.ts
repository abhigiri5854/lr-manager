// Shrinks photos in the browser before they are uploaded, so a 6 MB phone photo goes up as a
// few hundred KB. PDFs (and SVGs, GIFs) are sent unchanged. Browser-only: uses canvas.

/** Server-side request limit for uploads (next.config serverActions.bodySizeLimit = "3mb"). */
export const UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
/** Room for the other form fields sent in the same request. */
const REQUEST_OVERHEAD = 64 * 1024;

export const MAX_IMAGE_SIDE = 1800;
export const JPEG_QUALITY = 0.8;

/** 6_291_456 → "6.0 MB", 512_000 → "500 KB" */
export function formatFileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The error shown when a file is still over the limit after compression. */
export function tooBigMessage(
  file: { name: string; size: number; type: string },
  maxBytes: number,
) {
  const advice =
    file.type === "application/pdf"
      ? "Save a smaller PDF (scan at lower quality or fewer pages), or upload photos of the pages instead."
      : "Try a smaller photo or a screenshot of it.";
  return `${file.name} is ${formatFileSize(file.size)} — the limit is ${formatFileSize(maxBytes)}. ${advice}`;
}

const SKIP = new Set(["image/svg+xml", "image/gif"]);

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * Longest side down to 1800px, re-encoded as JPEG at 0.8. With keepTransparency (logos,
 * signatures) a PNG/WebP that has see-through pixels stays PNG so it doesn't get a white box.
 * Returns the original file when it can't be decoded (e.g. HEIC in Chrome) or is already smaller.
 */
export async function compressImage(
  file: File,
  opts: { keepTransparency?: boolean } = {},
): Promise<File> {
  if (!file.type.startsWith("image/") || SKIP.has(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    // Applies the photo's EXIF rotation, so portrait phone photos stay upright.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const keepPng =
    Boolean(opts.keepTransparency) && file.type !== "image/jpeg" && hasTransparency(ctx, w, h);
  if (!keepPng) {
    // JPEG has no transparency: put a white page behind it instead of black.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);
  }
  const type = keepPng ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, JPEG_QUALITY),
  );
  if (!blob || (scale === 1 && blob.size >= file.size)) return file;
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}.${keepPng ? "png" : "jpg"}`, {
    type,
    lastModified: file.lastModified,
  });
}

export type PreparedUpload = { ok: true; file: File } | { ok: false; message: string };

/** Compress (images only), then check the size. maxBytes is capped at the request limit. */
export async function prepareUpload(
  file: File,
  opts: { maxBytes?: number; keepTransparency?: boolean } = {},
): Promise<PreparedUpload> {
  const max = Math.min(opts.maxBytes ?? UPLOAD_MAX_BYTES, UPLOAD_MAX_BYTES);
  const out = await compressImage(file, opts);
  // The request also carries other fields, so leave a little room under the hard limit.
  const room = max === UPLOAD_MAX_BYTES ? max - REQUEST_OVERHEAD : max;
  if (out.size > room) return { ok: false, message: tooBigMessage(out, max) };
  return { ok: true, file: out };
}

// Which files Smart import accepts, and the checks on them. Used by the upload cards (browser)
// and again by the upload route (server). This looks at the name, size and first bytes only —
// reading the content is the reader's job.

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export type ImportFormat = "xlsx" | "xls" | "csv" | "pdf" | "jpg" | "png";
export type ImportSource = "excel" | "document";

/** What each upload card accepts. */
export const SOURCE_FORMATS: Record<ImportSource, readonly ImportFormat[]> = {
  excel: ["xlsx", "xls", "csv"],
  document: ["pdf", "jpg", "png", "xlsx"],
};

export const ACCEPT_ATTR: Record<ImportSource, string> = {
  excel: ".xlsx,.xls,.csv",
  document: ".pdf,.jpg,.jpeg,.png,.xlsx",
};

const SOURCE_HINT: Record<ImportSource, string> = {
  excel: ".xlsx, .xls or .csv",
  document: "PDF, JPG, PNG or .xlsx",
};

export const FORMAT_LABEL: Record<ImportFormat, string> = {
  xlsx: "Excel (.xlsx)",
  xls: "Excel (.xls)",
  csv: "CSV",
  pdf: "PDF",
  jpg: "Photo (JPG)",
  png: "Photo (PNG)",
};

export function formatOf(fileName: string): ImportFormat | null {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "jpeg") return "jpg";
  return ext && ["xlsx", "xls", "csv", "pdf", "jpg", "png"].includes(ext)
    ? (ext as ImportFormat)
    : null;
}

export type FileKind = "excel" | "csv" | "pdf" | "image";
export const kindOf = (f: ImportFormat): FileKind =>
  f === "csv" ? "csv" : f === "pdf" ? "pdf" : f === "jpg" || f === "png" ? "image" : "excel";

export const isImage = (f: ImportFormat) => f === "jpg" || f === "png";

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);

/** True when the first bytes fit the claimed format (a renamed .exe isn't a .pdf). */
export function sniffMatches(format: ImportFormat, bytes: Uint8Array): boolean {
  switch (format) {
    case "pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case "xlsx":
      return startsWith(bytes, [0x50, 0x4b]); // PK (zip)
    case "xls":
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]);
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
    case "jpg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "csv":
      return !bytes.subarray(0, 4096).includes(0); // text: no NUL bytes
  }
}

export type FileCheck = { ok: true; format: ImportFormat } | { ok: false; message: string };

/** Name + size check, before any bytes are read (the browser can run it too). */
export function checkImportFile(
  file: { name: string; size: number },
  source: ImportSource,
  maxBytes = IMPORT_MAX_BYTES,
): FileCheck {
  const format = formatOf(file.name);
  if (!format || !SOURCE_FORMATS[source].includes(format)) {
    return { ok: false, message: `${file.name}: only ${SOURCE_HINT[source]} files can go here.` };
  }
  if (file.size === 0) return { ok: false, message: `${file.name}: the file is empty.` };
  if (file.size > maxBytes) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    const limit = Math.round(maxBytes / (1024 * 1024));
    const advice = isImage(format)
      ? "Try a smaller photo."
      : format === "pdf"
        ? "Save a smaller PDF (scan at lower quality or fewer pages), or upload photos of the pages."
        : "Save it with fewer rows, or split it into two files.";
    return { ok: false, message: `${file.name} is ${mb} MB — the limit is ${limit} MB. ${advice}` };
  }
  return { ok: true, format };
}

/** The same check on the server, including the first bytes. */
export function checkImportBytes(
  file: { name: string; bytes: Uint8Array },
  source: ImportSource,
): FileCheck {
  const named = checkImportFile({ name: file.name, size: file.bytes.byteLength }, source);
  if (!named.ok) return named;
  if (!sniffMatches(named.format, file.bytes)) {
    return {
      ok: false,
      message: `${file.name}: the file doesn't look like a real ${named.format.toUpperCase()}.`,
    };
  }
  return named;
}

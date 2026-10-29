import { notOnDatabaseResponse, onDatabase } from "@/lib/data/source";
import { NextResponse } from "next/server";
import { ValidationError, ForbiddenError } from "@/lib/data/errors";
import { createImportBatch } from "@/lib/data/import";
import { getActiveCompanyId, getSessionUserId } from "@/lib/data/session";
import { checkImportFile } from "@/lib/import/file-types";

// POST /import/upload — one file per request, as multipart form data ("source", "file").
// A route handler, not a server action: PDFs and workbooks go up to 10 MB, more than the
// 3 MB server-action limit. (next.config.ts raises proxyClientMaxBodySize so proxy.ts doesn't cut them.)
export async function POST(request: Request) {
  if (onDatabase()) return notOnDatabaseResponse();
  if (!(await getSessionUserId())) {
    return NextResponse.json({ ok: false, message: "Please log in again." }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const source = form?.get("source") === "excel" ? "excel" : "document";
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "Choose a file to upload." }, { status: 400 });
  }
  // Cheap checks first, so a huge wrong file is refused before it is read.
  const named = checkImportFile({ name: file.name, size: file.size }, source);
  if (!named.ok) return NextResponse.json({ ok: false, message: named.message }, { status: 400 });

  try {
    const batch = await createImportBatch(await getActiveCompanyId(), {
      source,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json({ ok: true, batchId: batch.id, status: batch.status });
  } catch (e) {
    if (e instanceof ValidationError || e instanceof ForbiddenError) {
      return NextResponse.json(
        { ok: false, message: e.message },
        { status: e instanceof ForbiddenError ? 403 : 400 },
      );
    }
    throw e;
  }
}

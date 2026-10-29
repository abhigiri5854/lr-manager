import {
  objectPath,
  podObjectPath,
  safeName,
  signedUrl,
  type CompanyBucket,
} from "@/lib/data/db/storage";
import { canReadPodFile, getUpload } from "@/lib/data/uploads";
import { getActiveCompanyId, getRole } from "@/lib/data/session";
import { onDatabase } from "@/lib/data/source";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Serves an uploaded file (signed copy, logo, signature) to users of the company that uploaded it. */
export async function GET(req: Request, ctx: RouteContext<"/uploads/[id]">) {
  const { id } = await ctx.params;
  const companyId = await getActiveCompanyId();
  if (onDatabase()) return fromStorage(req, id, companyId);
  const file = await getUpload(companyId, id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      // An SVG opened on its own must not run scripts on our origin.
      ...(file.type === "image/svg+xml" && {
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      }),
    },
  });
}

/**
 * DATA_SOURCE=db: company logos / signatures live in private Storage buckets under the company's
 * folder. Office roles of the "Working as" company get a short-lived signed URL (redirect), so
 * the file is served from Storage, not from our origin.
 */
async function fromStorage(req: Request, id: string, companyId: string) {
  const q = new URL(req.url).searchParams;
  const bucket = q.get("b");
  const name = q.get("n") ?? "";
  if (bucket === "pod") return podFromStorage(id, name, q.get("l") ?? "", companyId);
  if ((bucket !== "logos" && bucket !== "signatures") || !UUID.test(id) || !name) {
    return new Response("Not found", { status: 404 });
  }
  if (safeName(name, "") !== name) return new Response("Not found", { status: 404 });
  const role = await getRole(companyId);
  if (!role || role === "driver") return new Response("Not found", { status: 404 });
  try {
    const url = await signedUrl(
      bucket as CompanyBucket,
      objectPath(bucket as CompanyBucket, companyId, id, name),
    );
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, max-age=60" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

/** Signed POD copies: the pod bucket, under the LR. Office roles, or a driver on their own trip. */
async function podFromStorage(id: string, name: string, lrId: string, companyId: string) {
  if (!UUID.test(id) || !UUID.test(lrId) || !name || safeName(name, "") !== name) {
    return new Response("Not found", { status: 404 });
  }
  try {
    if (!(await canReadPodFile(companyId, lrId))) return new Response("Not found", { status: 404 });
    const url = await signedUrl("pod", podObjectPath(companyId, lrId, id, name));
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, max-age=60" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

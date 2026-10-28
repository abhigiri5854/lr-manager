import { getUpload } from "@/lib/data/uploads";
import { getActiveCompanyId } from "@/lib/data/session";

/** Serves an uploaded signed copy to users of the company that uploaded it. */
export async function GET(_req: Request, ctx: RouteContext<"/uploads/[id]">) {
  const { id } = await ctx.params;
  const file = await getUpload(await getActiveCompanyId(), id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

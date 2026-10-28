import { errorReportRows } from "@/lib/data/import";
import { getActiveCompanyId } from "@/lib/data/session";
import { importErrorReportWorkbook } from "@/lib/export/import-errors-xlsx";

/** GET /import/<batch>/errors → .xlsx of the rows that couldn't be imported. */
export async function GET(_req: Request, ctx: RouteContext<"/import/[batchId]/errors">) {
  const { batchId } = await ctx.params;
  const report = await errorReportRows(await getActiveCompanyId(), batchId);
  if (!report) return new Response("Not found", { status: 404 });
  const base = report.fileName.replace(/\.[^.]+$/, "");
  return new Response(Buffer.from(importErrorReportWorkbook(report)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}-errors.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

import type { NextRequest } from "next/server";
import { lrRegisterWorkbook } from "@/lib/export/lr-register-xlsx";
import { LR_EXPORT_LIMIT, listLrsForExport } from "@/lib/data/lrs";
import { getActiveCompanyId } from "@/lib/data/session";
import { parseLrRegisterQuery, toLrListParams } from "@/lib/validators/lr-register";

/** GET /lr/export?<register filters> → .xlsx of every matching LR (not just the current page). */
export async function GET(request: NextRequest) {
  const companyId = await getActiveCompanyId();
  const filters = toLrListParams(parseLrRegisterQuery(request.nextUrl.searchParams));
  // Every page, so `page` is ignored.
  const { rows, total } = await listLrsForExport(companyId, filters);
  const today = new Date().toISOString().slice(0, 10);

  return new Response(Buffer.from(lrRegisterWorkbook(rows)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="lr-register-${today}.xlsx"`,
      "Cache-Control": "no-store",
      // Lets a caller tell the file was cut short.
      "X-Total-Count": String(total),
      "X-Row-Limit": String(LR_EXPORT_LIMIT),
    },
  });
}

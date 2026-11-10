import type { NextRequest } from "next/server";
import { listChallanRegisterAll } from "@/lib/data/challans";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { challanRegisterWorkbook } from "@/lib/export/challan-register-xlsx";
import { can } from "@/lib/permissions";
import { parseChallanListQuery } from "@/lib/validators/challan-list";

/** GET /market-trucks/challans/export?<same filters as the register> → .xlsx of every matching challan. */
export async function GET(request: NextRequest) {
  const companyId = await getActiveCompanyId();
  if (!can(await getActiveRole(), "freight.view")) {
    return new Response("Your role can't see freight amounts.", { status: 403 });
  }
  // The page number in the URL is ignored: the export has every matching row.
  const filters = parseChallanListQuery(request.nextUrl.searchParams);
  const { rows } = await listChallanRegisterAll(companyId, filters);
  const today = new Date().toISOString().slice(0, 10);

  return new Response(Buffer.from(challanRegisterWorkbook(rows)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="challans-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

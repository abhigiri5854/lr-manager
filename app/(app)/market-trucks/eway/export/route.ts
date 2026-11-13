import type { NextRequest } from "next/server";
import { listEwbRows } from "@/lib/data/ewb";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { ewayWorkbook } from "@/lib/export/eway-xlsx";
import { can } from "@/lib/permissions";
import { parseEwbListQuery } from "@/lib/validators/ewb-list";

/** GET /market-trucks/eway/export?when=… → .xlsx of every e-way bill matching the filter. */
export async function GET(request: NextRequest) {
  const companyId = await getActiveCompanyId();
  if (!can(await getActiveRole(), "freight.view")) {
    return new Response("Your role can't see freight amounts.", { status: 403 });
  }
  const { when } = parseEwbListQuery(request.nextUrl.searchParams);
  const rows = await listEwbRows(companyId, when);
  const today = new Date().toISOString().slice(0, 10);
  return new Response(Buffer.from(ewayWorkbook(rows)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="eway-bills-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

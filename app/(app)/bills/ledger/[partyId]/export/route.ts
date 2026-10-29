import type { NextRequest } from "next/server";
import { getPartyLedger } from "@/lib/data/bills";
import { getPartyById } from "@/lib/data/parties";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { partyLedgerWorkbook } from "@/lib/export/party-ledger-xlsx";
import { can } from "@/lib/permissions";

/** GET /bills/ledger/<party>/export → .xlsx of the party's bills, receipts and TDS. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/bills/ledger/[partyId]/export">) {
  const { partyId } = await ctx.params;
  const companyId = await getActiveCompanyId();
  if (!can(await getActiveRole(), "freight.view")) {
    return new Response("Your role can't see freight amounts.", { status: 403 });
  }
  const party = await getPartyById(companyId, partyId);
  if (!party) return new Response("Party not found", { status: 404 });
  const ledger = await getPartyLedger(companyId, partyId);
  const today = new Date().toISOString().slice(0, 10);
  const safeName = party.name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "party";

  return new Response(Buffer.from(partyLedgerWorkbook(party.name, ledger)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ledger-${safeName}-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

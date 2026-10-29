import type { Metadata } from "next";
import { Suspense } from "react";
import { BillKpis, BillKpisLoading } from "@/components/bills/BillKpis";
import { BillList } from "@/components/bills/BillList";
import { PartyDuesTable } from "@/components/bills/PartyDuesTable";
import { RecordPaymentCard } from "@/components/bills/RecordPaymentCard";
import { Button } from "@/components/ui/Button";
import { IfCan } from "@/components/ui/Permissions";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { getBillsSummary, listFreightBills } from "@/lib/data/bills";
import { listPartyOptions } from "@/lib/data/parties";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { can } from "@/lib/permissions";
import { parseBillListQuery } from "@/lib/validators/bill-list";

export const metadata: Metadata = { title: "Bills & payments" };

const TITLE = "Freight bills & payments";
const SUBTITLE = "Every bill, every receipt, and what each party still owes.";

/** Per request: reads the URL, the role and the active company. */
async function BillsLoader({ searchParams }: Pick<PageProps<"/bills">, "searchParams">) {
  const query = parseBillListQuery(await searchParams);
  const [companyId, role] = await Promise.all([getActiveCompanyId(), getActiveRole()]);
  if (!can(role, "freight.view")) {
    return (
      <NoAccess
        title={TITLE}
        role={role}
        action="freight.view"
        back={{ href: "/", label: "Open Dashboard" }}
      />
    );
  }
  const [summary, page, parties] = await Promise.all([
    getBillsSummary(companyId),
    listFreightBills(companyId, {
      search: query.q,
      status: query.status,
      from: query.from,
      to: query.to,
      partyId: query.party,
      page: query.page,
    }),
    listPartyOptions(companyId),
  ]);
  const { unbilledTbbLrs } = summary.overview;
  return (
    <>
      <BillKpis data={summary.overview} />
      <BillList
        query={query}
        page={page}
        parties={parties}
        unbilledNote={
          unbilledTbbLrs > 0
            ? `${unbilledTbbLrs} TBB ${unbilledTbbLrs === 1 ? "LR is" : "LRs are"} ready to bill — make the first bill.`
            : null
        }
      />
      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[999_1_560px]">
          <PartyDuesTable rows={summary.dues} />
        </div>
        <div className="min-w-0 flex-[1_1_340px]">
          <RecordPaymentCard parties={parties} />
        </div>
      </div>
    </>
  );
}

function BillsLoading() {
  return (
    <>
      <BillKpisLoading />
      <BillList query={{ page: 1 }} parties={[]} loading />
    </>
  );
}

export default function BillsPage({ searchParams }: PageProps<"/bills">) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={TITLE}
        subtitle={SUBTITLE}
        actions={
          <IfCan action="bill.edit">
            <Button href="/bills/new">+ New freight bill</Button>
          </IfCan>
        }
      />
      <Suspense fallback={<BillsLoading />}>
        <BillsLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

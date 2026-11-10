import type { Metadata } from "next";
import { Suspense } from "react";
import { PayTruckForm } from "@/components/market-trucks/PayTruckForm";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { getChallan } from "@/lib/data/challans";
import { listBranches, listPumps } from "@/lib/data/hire-masters";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { listTruckPartyRows } from "@/lib/data/truck-parties";
import { listPayableChallans } from "@/lib/data/truck-payments";
import { todayInIndia } from "@/lib/fy";
import { toPayeePick } from "@/lib/truck-payee-pick";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "New truck payment" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Per request: reads ?challanId=, the active company and role. */
async function Loader({ searchParams }: Pick<PageProps<"/market-trucks/payments/new">, "searchParams">) {
  const role = await getActiveRole();
  if (!can(role, "bill.edit")) {
    return (
      <NoAccess
        title="New truck payment"
        role={role}
        action="bill.edit"
        back={{ href: "/market-trucks/payments", label: "Back to truck payments" }}
      />
    );
  }
  const raw = (await searchParams).challanId;
  const challanId = typeof raw === "string" && UUID.test(raw) ? raw : null;
  const companyId = await getActiveCompanyId();
  const [branches, pumps, challan] = await Promise.all([
    listBranches(companyId),
    listPumps(companyId),
    challanId ? getChallan(companyId, challanId) : Promise.resolve(null),
  ]);

  // Prefill from the challan: its "Pay to" party and that party's open challans.
  const payeeId = challan && !challan.cancelledAt ? challan.payeePartyId : null;
  const [challans, payee] = payeeId
    ? await Promise.all([
        listPayableChallans(companyId, payeeId),
        listTruckPartyRows(companyId, { search: challan?.payeeName ?? "", pageSize: 20 }).then((page) => {
          const hit = page.rows.find((p) => p.id === payeeId);
          return hit ? toPayeePick(hit) : null;
        }),
      ])
    : [[], null];

  const live = branches.filter((b) => !b.cancelledAt);
  return (
    <>
      <PageHeader
        title="New truck payment"
        subtitle="Pay a truck owner or broker. Recording payments here is optional."
        breadcrumb={[{ label: "Truck payments", href: "/market-trucks/payments" }, { label: "New payment" }]}
        breadcrumbPlacement="inline"
      />
      <PayTruckForm
        branches={live.map((b) => ({ id: b.id, name: b.name }))}
        pumps={(pumps ?? []).filter((u) => !u.cancelledAt).map((u) => ({ id: u.id, name: u.name }))}
        today={todayInIndia()}
        defaultBranchId={
          challan && live.some((b) => b.id === challan.branchId) ? challan.branchId : (live[0]?.id ?? "")
        }
        initialPayee={payee}
        initialChallans={challans}
        initialChallanId={challanId}
      />
    </>
  );
}

export default function NewPaymentPage({ searchParams }: PageProps<"/market-trucks/payments/new">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Loader searchParams={searchParams} />
    </Suspense>
  );
}

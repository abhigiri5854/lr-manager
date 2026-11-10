import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChallanForm } from "@/components/market-trucks/ChallanForm";
import { ChallanPayments } from "@/components/market-trucks/ChallanPayments";
import { Chip } from "@/components/ui/Chip";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { getChallan, getChallanLrPicks } from "@/lib/data/challans";
import { listBranches, listChargeTypes } from "@/lib/data/hire-masters";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { listPaymentsForChallan } from "@/lib/data/truck-payments";
import { todayInIndia } from "@/lib/fy";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Challan" };

/** Per request: reads the URL, the active company and role. */
async function Challan({ params }: Pick<PageProps<"/market-trucks/challans/[id]">, "params">) {
  const role = await getActiveRole();
  if (!can(role, "freight.view")) {
    return (
      <NoAccess
        title="Challan"
        role={role}
        action="freight.view"
        back={{ href: "/", label: "Back to the dashboard" }}
      />
    );
  }
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const challan = await getChallan(companyId, id);
  if (!challan || challan.cancelledAt) notFound();
  const [picks, branches, chargeTypes, payments] = await Promise.all([
    getChallanLrPicks(companyId, challan.id, challan.lrs.map((l) => l.lrId)),
    listBranches(companyId),
    listChargeTypes(companyId),
    listPaymentsForChallan(companyId, challan.id),
  ]);
  return (
    <>
      <PageHeader
        title={
          <>
            Challan <span className="font-mono">{challan.challanNo}</span>{" "}
            <Chip tone={challan.status === "draft" ? "amber" : "green"}>
              {challan.status.replace("_", " ")}
            </Chip>
          </>
        }
        breadcrumb={[{ label: "Dashboard", href: "/" }, { label: `Challan ${challan.challanNo}` }]}
        breadcrumbPlacement="inline"
      />
      <ChallanForm
        challan={challan}
        initialPicks={picks}
        branches={branches}
        // A saved challan keeps showing a charge type that was switched off since.
        chargeTypes={chargeTypes.filter(
          (t) =>
            t.stage === "hire" && (t.active || challan.charges.some((c) => c.chargeTypeId === t.id)),
        )}
        today={todayInIndia()}
      />
      <div className="mt-5">
        <ChallanPayments challanId={challan.id} payments={payments} canRecord={can(role, "bill.edit")} />
      </div>
    </>
  );
}

export default function ChallanPage({ params }: PageProps<"/market-trucks/challans/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Challan params={params} />
    </Suspense>
  );
}

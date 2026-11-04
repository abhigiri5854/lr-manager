import type { Metadata } from "next";
import { Suspense } from "react";
import { ChallanForm } from "@/components/market-trucks/ChallanForm";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { listBranches, listChargeTypes } from "@/lib/data/hire-masters";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { todayInIndia } from "@/lib/fy";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "New challan" };

/** Per request: reads the active company and role. */
async function NewChallan() {
  const role = await getActiveRole();
  if (!can(role, "lr.edit")) {
    return (
      <NoAccess
        title="New challan"
        role={role}
        action="lr.edit"
        back={{ href: "/", label: "Back to the dashboard" }}
      />
    );
  }
  const companyId = await getActiveCompanyId();
  const [branches, chargeTypes] = await Promise.all([
    listBranches(companyId),
    listChargeTypes(companyId),
  ]);
  return (
    <>
      <PageHeader
        title="New challan"
        subtitle="Hire a market truck for one or more LRs. The number is allocated when you save."
        breadcrumb={[{ label: "Dashboard", href: "/" }, { label: "New challan" }]}
        breadcrumbPlacement="inline"
      />
      <ChallanForm
        branches={branches}
        chargeTypes={chargeTypes.filter((t) => t.active && t.stage === "hire")}
        today={todayInIndia()}
      />
    </>
  );
}

export default function NewChallanPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <NewChallan />
    </Suspense>
  );
}

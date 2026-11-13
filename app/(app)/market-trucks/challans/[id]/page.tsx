import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChallanForm } from "@/components/market-trucks/ChallanForm";
import { ChallanEwb } from "@/components/market-trucks/ChallanEwb";
import { ChangeVehicle } from "@/components/market-trucks/ChangeVehicle";
import { EwbTasks } from "@/components/market-trucks/EwbTasks";
import { getOpenEwbTasks } from "@/lib/data/ewb";
import { VEHICLE_CHANGE_STATUSES } from "@/lib/validators/challan-vehicle";
import { ChallanPayments } from "@/components/market-trucks/ChallanPayments";
import { ChallanPod } from "@/components/market-trucks/ChallanPod";
import { ChallanTrip } from "@/components/market-trucks/ChallanTrip";
import { Chip } from "@/components/ui/Chip";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { getChallanSettlement } from "@/lib/data/challan-pod";
import { getChallan, getChallanLrPicks } from "@/lib/data/challans";
import { listTripEvents } from "@/lib/data/driver-links";
import { listBranches, listChargeTypes } from "@/lib/data/hire-masters";
import { getMarketDriverById } from "@/lib/data/market-drivers";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { listPaymentsForChallan } from "@/lib/data/truck-payments";
import { todayInIndia } from "@/lib/fy";
import { can } from "@/lib/permissions";

export async function generateMetadata({
  params,
}: PageProps<"/market-trucks/challans/[id]">): Promise<Metadata> {
  const { id } = await params;
  try {
    const challan = await getChallan(await getActiveCompanyId(), id);
    if (challan) return { title: `Challan ${challan.challanNo}` };
  } catch {
    // fall back to the generic title
  }
  return { title: "Challan" };
}

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
  const canTrip = can(role, "master.edit");
  const [picks, branches, chargeTypes, payments, settlement, tripEvents, driverRows, ewbTasks] = await Promise.all([
    getChallanLrPicks(companyId, challan.id, challan.lrs.map((l) => l.lrId)),
    listBranches(companyId),
    listChargeTypes(companyId),
    listPaymentsForChallan(companyId, challan.id),
    getChallanSettlement(companyId, challan.id),
    listTripEvents(companyId, challan.id),
    challan.driverId ? getMarketDriverById(companyId, challan.driverId) : Promise.resolve(null),
    getOpenEwbTasks(companyId, challan.id),
  ]);
  const canChangeVehicle =
    canTrip && (VEHICLE_CHANGE_STATUSES as readonly string[]).includes(challan.status);
  const driverRow = driverRows;
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
        actions={
          canChangeVehicle ? (
            <ChangeVehicle
              challanId={challan.id}
              version={challan.version}
              currentVehicleNo={challan.vehicleNo ?? null}
            />
          ) : undefined
        }
      />
      <EwbTasks tasks={ewbTasks} canEdit={canTrip} />
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
      {challan.status !== "draft" && (
        <ChallanEwb
          challanId={challan.id}
          version={challan.version}
          lines={challan.lrs}
          canEdit={canTrip && challan.status !== "settled"}
        />
      )}
      {challan.status !== "draft" && (
        <ChallanTrip
          challanId={challan.id}
          events={tripEvents}
          driver={
            challan.driverId
              ? {
                  id: challan.driverId,
                  name: challan.driverName ?? "Driver",
                  mobile: driverRow?.mobile ?? null,
                }
              : null
          }
          canEdit={canTrip}
        />
      )}
      {settlement && (
        <ChallanPod
          initial={settlement}
          chargeTypes={chargeTypes.filter(
            (t) =>
              t.stage === "pod" &&
              (t.active || settlement.charges.some((c) => c.chargeTypeId === t.id)),
          )}
          canPod={can(role, "pod.upload")}
          canBill={can(role, "bill.edit")}
          canCancel={can(role, "record.cancel")}
        />
      )}
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

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PodForm } from "@/components/pod/PodForm";
import { PodSkeleton } from "@/components/pod/PodSkeleton";
import { getPodScreen } from "@/lib/data/pod";
import { getActiveCompanyId } from "@/lib/data/session";

export const metadata: Metadata = { title: "POD" };

const NOTICES: Record<string, string> = {
  delivered: "Delivery saved. Add the signed copy to mark the POD received.",
  received: "Saved — signed copy received, POD complete.",
};

/** Per request: reads the URL and the active company. */
async function PodScreen({
  params,
  searchParams,
}: Pick<PageProps<"/lr/[id]/pod">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const screen = await getPodScreen(await getActiveCompanyId(), id);
  if (!screen) notFound();
  const { lr, pod } = screen;
  const saved = Array.isArray(query.saved) ? query.saved[0] : query.saved;

  const readOnlyReason = lr.cancelledAt
    ? "This LR is cancelled — its POD can't be changed."
    : !lr.bookedAt
      ? "Book the LR before recording delivery."
      : pod?.cancelledAt
        ? "This POD is cancelled."
        : null;

  return (
    <PodForm
      // Remount after every save so the form shows the saved values and the new version.
      key={`${lr.id}-${pod?.version ?? 0}-${lr.version}`}
      lr={{
        id: lr.id,
        lrNo: lr.lrNo,
        lrDate: lr.lrDate,
        status: lr.status,
        consignor: lr.consignorName,
        consignee: lr.consigneeName,
        truck: lr.truckNumber,
        totalPackages: lr.totalPackages,
        deliveredOn: lr.deliveredAt?.slice(0, 10) ?? "",
      }}
      pod={
        pod && {
          id: pod.id,
          version: pod.version,
          receivedBy: pod.receivedBy ?? "",
          receiverPhone: pod.receiverPhone ?? "",
          packagesReceived: pod.packagesReceived,
          condition: pod.condition,
          remarks: pod.remarks ?? "",
          documentUrls: pod.documentUrls,
        }
      }
      podDays={screen.podDays}
      podPenaltyPerDay={screen.podPenaltyPerDay}
      today={screen.today}
      notice={saved ? (NOTICES[saved] ?? null) : null}
      readOnlyReason={readOnlyReason}
    />
  );
}

export default function PodPage({ params, searchParams }: PageProps<"/lr/[id]/pod">) {
  return (
    <Suspense fallback={<PodSkeleton />}>
      <PodScreen params={params} searchParams={searchParams} />
    </Suspense>
  );
}

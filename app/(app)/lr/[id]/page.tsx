import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LrDetailSkeleton } from "@/components/lr/LrDetailSkeleton";
import { LrDetailView } from "@/components/lr/LrDetailView";
import { getLrDetail } from "@/lib/data/lr-detail";
import { getActiveCompanyId } from "@/lib/data/session";

export const metadata: Metadata = { title: "LR detail" };

/** The LR plus the current time (e-way alerts compare expiry with now). */
async function loadDetail(params: PageProps<"/lr/[id]">["params"]) {
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const detail = await getLrDetail(companyId, id);
  if (!detail) notFound();
  return { detail, nowMs: Date.now() };
}

/** Per request: reads the URL and the active company. */
async function LrDetail({ params }: Pick<PageProps<"/lr/[id]">, "params">) {
  const { detail, nowMs } = await loadDetail(params);
  return <LrDetailView detail={detail} nowMs={nowMs} />;
}

export default function LrDetailPage({ params }: PageProps<"/lr/[id]">) {
  return (
    <Suspense fallback={<LrDetailSkeleton />}>
      <LrDetail params={params} />
    </Suspense>
  );
}

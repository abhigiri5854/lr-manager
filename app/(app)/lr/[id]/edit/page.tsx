import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LrForm } from "@/components/lr/LrForm";
import { LrFormSkeleton } from "@/components/lr/LrFormSkeleton";
import { getLrById } from "@/lib/data/lrs";
import { getActiveCompanyId } from "@/lib/data/session";
import { todayInIndia } from "@/lib/fy";
import { lrToForm } from "@/lib/lr-form";
import { loadLinkedInvoice, loadPicked } from "../../load-form";

export const metadata: Metadata = { title: "Edit LR" };

type Props = PageProps<"/lr/[id]/edit">;

/** Per request: reads the URL and the active company. */
async function EditLr({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  const companyId = await getActiveCompanyId();
  const lr = await getLrById(companyId, id);
  if (!lr) notFound();

  const initial = lrToForm(lr, { today: todayInIndia() });
  const [picked, linkedInvoice] = await Promise.all([
    loadPicked(companyId, initial),
    loadLinkedInvoice(companyId, initial),
  ]);

  return (
    <LrForm
      // Remount after a save so the form starts from the saved values and version.
      key={`${lr.id}-${lr.version}`}
      initial={initial}
      picked={picked}
      lr={{
        id: lr.id,
        lrNo: lr.lrNo,
        version: lr.version,
        status: lr.status,
        booked: lr.bookedAt !== null,
      }}
      linkedInvoice={linkedInvoice}
      notice={saved ? (lr.bookedAt ? "Changes saved." : "Draft saved.") : null}
      readOnlyReason={
        lr.status === "Cancelled"
          ? `This LR was cancelled${lr.cancelReason ? ` (${lr.cancelReason})` : ""} and can't be changed.`
          : null
      }
    />
  );
}

export default function EditLrPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<LrFormSkeleton mode="edit" />}>
      <EditLr params={params} searchParams={searchParams} />
    </Suspense>
  );
}

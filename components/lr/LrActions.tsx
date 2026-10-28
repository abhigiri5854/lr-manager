import Link from "next/link";
import type { LrStatus, LrView } from "@/lib/types";
import { LrRowMenu } from "./LrRowMenu";

type Primary = { label: string; href: (id: string) => string };

/** The next step for an LR, by status. Paid and cancelled LRs have none. */
const PRIMARY: Partial<Record<LrStatus, Primary>> = {
  Draft: { label: "Finish", href: (id) => `/lr/${id}/edit` },
  Booked: { label: "Mark delivered", href: (id) => `/lr/${id}/pod` },
  "In transit": { label: "Mark delivered", href: (id) => `/lr/${id}/pod` },
  Delivered: { label: "Upload POD", href: (id) => `/lr/${id}/pod` },
  "POD received": { label: "Make bill", href: (id) => `/bills/new?lr=${id}` },
  Billed: { label: "Record payment", href: (id) => `/bills?lr=${id}` },
};

/** Once on a final bill an LR is locked, so it can't be cancelled from here. */
const CANCELLABLE: LrStatus[] = ["Draft", "Booked", "In transit", "Delivered", "POD received"];

/**
 * Row actions: the status's next step plus a "⋯" menu (Print, Repeat, Cancel LR).
 * Sits above a clickable row's overlay link (`relative z-10`).
 */
export function LrActions({ lr }: { lr: LrView }) {
  const primary = PRIMARY[lr.status];
  return (
    <div className="relative z-10 flex items-center justify-between gap-2">
      {primary ? <Link href={primary.href(lr.id)}>{primary.label}</Link> : <span />}
      <LrRowMenu
        lrId={lr.id}
        lrNo={lr.lrNo}
        canPrint={lr.status !== "Draft" && lr.status !== "Cancelled"}
        canCancel={CANCELLABLE.includes(lr.status)}
      />
    </div>
  );
}

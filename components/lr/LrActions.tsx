import Link from "next/link";
import type { Action } from "@/lib/permissions";
import type { LrStatus, LrView } from "@/lib/types";
import { LrRowMenu } from "./LrRowMenu";
import { IfCan } from "@/components/ui/Permissions";

/** `action` = what the role must be allowed (lib/permissions.ts) to see the button. */
type Primary = { label: string; href: (id: string) => string; action: Action };

/** The next step for an LR, by status. Paid and cancelled LRs have none. */
const PRIMARY: Partial<Record<LrStatus, Primary>> = {
  Draft: { label: "Finish", href: (id) => `/lr/${id}/edit`, action: "lr.edit" },
  Booked: { label: "Mark delivered", href: (id) => `/lr/${id}/pod`, action: "pod.upload" },
  "In transit": { label: "Mark delivered", href: (id) => `/lr/${id}/pod`, action: "pod.upload" },
  Delivered: { label: "Upload POD", href: (id) => `/lr/${id}/pod`, action: "pod.upload" },
  "POD received": { label: "Make bill", href: (id) => `/bills/new?lr=${id}`, action: "bill.edit" },
  Billed: { label: "Record payment", href: (id) => `/bills?lr=${id}`, action: "bill.edit" },
};

/** Once on a final bill an LR is locked, so it can't be cancelled from here. */
export const CANCELLABLE: LrStatus[] = [
  "Draft",
  "Booked",
  "In transit",
  "Delivered",
  "POD received",
];

/** The next step for an LR (register row and detail header share it). */
export function lrPrimaryAction(
  lr: Pick<LrView, "id" | "status">,
): { label: string; href: string; action: Action } | null {
  const p = PRIMARY[lr.status];
  return p ? { label: p.label, href: p.href(lr.id), action: p.action } : null;
}

/**
 * Row actions: the status's next step plus a "⋯" menu (Print, Repeat, Cancel LR).
 * Sits above a clickable row's overlay link (`relative z-10`).
 */
export function LrActions({ lr }: { lr: LrView }) {
  const primary = PRIMARY[lr.status];
  return (
    <div className="relative z-10 flex items-center justify-between gap-2">
      {primary ? (
        <IfCan action={primary.action} fallback={<span />}>
          <Link href={primary.href(lr.id)}>{primary.label}</Link>
        </IfCan>
      ) : (
        <span />
      )}
      <LrRowMenu
        lrId={lr.id}
        lrNo={lr.lrNo}
        canPrint={lr.status !== "Draft" && lr.status !== "Cancelled"}
        canCancel={CANCELLABLE.includes(lr.status)}
      />
    </div>
  );
}

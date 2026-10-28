import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { formatRupees } from "@/lib/format";
import type { Dashboard } from "@/lib/types";

type KpiProps = {
  label: ReactNode;
  value: ReactNode;
  sub: ReactNode;
  /** Amber card when something needs action (Main.dc.html e-way bill card). */
  warning?: boolean;
};

function Kpi({ label, value, sub, warning }: KpiProps) {
  return (
    <div
      className={cx(
        "rounded-card border p-5",
        warning
          ? "border-warning-border bg-warning-soft text-warning"
          : "border-border bg-surface text-text",
      )}
    >
      <div className={cx("text-[13px]", !warning && "text-muted")}>{label}</div>
      <div className="mt-1.5 text-[32px] font-bold">{value}</div>
      <div className={cx("text-[13px]", !warning && "text-muted")}>{sub}</div>
    </div>
  );
}

/** 4 across on wide screens, 2 on tablets, 1 on phones (by the space the page has). */
export function KpiGrid({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @min-[440px]:grid-cols-2 @min-[880px]:grid-cols-4">
        {children}
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function KpiCards({ data }: { data: Dashboard }) {
  const { openLrs, eway, pod, freight } = data;

  const openParts = [
    openLrs.inTransit && `${openLrs.inTransit} in transit`,
    openLrs.booked && `${openLrs.booked} booked`,
    openLrs.draft && plural(openLrs.draft, "draft", "drafts"),
  ].filter(Boolean);

  const ewaySub =
    eway.total === 0
      ? "None expiring soon"
      : eway.expired > 0
        ? `${eway.expired} already expired`
        : "Extend before expiry";

  return (
    <KpiGrid>
      <Kpi
        label="Open LRs"
        value={openLrs.total}
        sub={openParts.length ? openParts.join(" · ") : "Nothing on the road"}
      />
      <Kpi
        label="E-way bills expiring ≤ 24 h"
        value={eway.total}
        sub={ewaySub}
        warning={eway.total > 0}
      />
      <Kpi
        label="POD pending"
        value={pod.pending}
        sub={
          pod.podDays !== null ? (
            `Due ${plural(pod.podDays, "day", "days")} after delivery`
          ) : (
            <Link href="/settings/company">Set POD days</Link>
          )
        }
      />
      <Kpi
        label="Freight to collect (TBB)"
        value={freight.toCollectPaise === null ? "₹ —" : formatRupees(freight.toCollectPaise)}
        sub={
          <>
            {freight.unbilledTbbLrs > 0 &&
              `${plural(freight.unbilledTbbLrs, "LR", "LRs")} not billed · `}
            <Link href="/bills/new">Make freight bill</Link>
          </>
        }
      />
    </KpiGrid>
  );
}

/** Same layout while the numbers load. */
export function KpiCardsLoading() {
  const labels = [
    "Open LRs",
    "E-way bills expiring ≤ 24 h",
    "POD pending",
    "Freight to collect (TBB)",
  ];
  return (
    <KpiGrid>
      {labels.map((label) => (
        <Kpi key={label} label={label} value="…" sub="Loading…" />
      ))}
    </KpiGrid>
  );
}

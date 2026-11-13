import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { formatRupees } from "@/lib/format";
import type { MarketDashboard } from "@/lib/data/market-dashboard";
import { KpiGrid } from "./KpiCards";

const BASE = "/market-trucks";

const ddmmyyyy = (iso: string) => iso.split("-").reverse().join("-");
const dateTimeIst = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(/\//g, "-")
    .replace(",", "");

function Box({
  href,
  label,
  value,
  sub,
  warning,
  children,
}: {
  /** Omit when the box holds its own links (a link can't contain links). */
  href?: string;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  warning?: boolean;
  children?: ReactNode;
}) {
  const className = cx(
    "block rounded-card border p-5",
    href && "hover:border-primary",
    warning
      ? "border-warning-border bg-warning-soft text-warning"
      : "border-border bg-surface text-text",
  );
  const body = (
    <>
      <div className={cx("text-[13px]", !warning && "text-muted")}>{label}</div>
      <div className="mt-1.5 text-[32px] font-bold">{value}</div>
      {sub && <div className={cx("text-[13px]", !warning && "text-muted")}>{sub}</div>}
      {children}
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function MarketTrucks({ data }: { data: MarketDashboard }) {
  const { outstanding, pod, expiring, margin, moving, pendingPayments } = data;
  const boxes: ReactNode[] = [];

  if (outstanding)
    boxes.push(
      <Box
        key="outstanding"
        href={`${BASE}/reports?tab=hire`}
        label="Hire outstanding"
        value={formatRupees(outstanding.balancePaise)}
        sub={plural(outstanding.parties, "party", "parties")}
      />,
    );

  if (pod)
    boxes.push(
      <Box
        key="pod"
        href={`${BASE}/reports?tab=pod`}
        label="POD pending"
        value={pod.n}
        sub={
          <span className="flex flex-wrap gap-x-3">
            <span>0–7: {pod.b0_7}</span>
            <span>8–15: {pod.b8_15}</span>
            <span>16–30: {pod.b16_30}</span>
            <span className={cx(pod.b30p > 0 && "font-semibold text-danger")}>30+: {pod.b30p}</span>
          </span>
        }
      />,
    );

  if (expiring)
    boxes.push(
      <Box
        key="expiring"
        label="Documents expiring ≤ 15 days"
        value={expiring.total}
        sub={expiring.total === 0 ? "Nothing expiring" : undefined}
        warning={expiring.total > 0}
      >
        {expiring.top.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[13px]">
            {expiring.top.map((d) => (
              <li key={`${d.kind}-${d.id}-${d.doc}`}>
                <Link
                  href={`${BASE}/${d.kind === "driver" ? "drivers" : "vehicles"}`}
                  className="underline"
                >
                  <span className={d.kind === "vehicle" ? "font-mono" : undefined}>{d.subject}</span>
                </Link>{" "}
                · {d.doc} ·{" "}
                {d.expired ? "expired " : ""}
                {ddmmyyyy(d.dueOn)}
              </li>
            ))}
          </ul>
        )}
      </Box>,
    );

  if (margin)
    boxes.push(
      <Box
        key="margin"
        href={`${BASE}/reports?tab=margin`}
        label="Low-margin trips this month"
        value={margin.lowCount}
        sub={`Margin this month ${formatRupees(margin.marginPaise)}`}
        warning={margin.lowCount > 0}
      />,
    );

  if (moving)
    boxes.push(
      <div
        key="moving"
        className="rounded-card border border-border bg-surface p-5 text-text"
      >
        <div className="text-[13px] text-muted">Trucks on the move</div>
        <div className="mt-1.5 text-[32px] font-bold">{moving.total}</div>
        {moving.top.length === 0 ? (
          <div className="text-[13px] text-muted">No trucks on the road</div>
        ) : (
          <ul className="mt-2 space-y-0.5 text-[13px]">
            {moving.top.map((t) => (
              <li key={t.challanId}>
                <Link href={`${BASE}/challans/${t.challanId}`} className="text-primary">
                  {t.challanNo}
                </Link>{" "}
                · <span className="font-mono">{t.vehicleNo ?? "—"}</span> · seen{" "}
                {dateTimeIst(t.lastSeenAt)}
              </li>
            ))}
          </ul>
        )}
      </div>,
    );

  if (pendingPayments)
    boxes.push(
      <Box
        key="pending"
        href={`${BASE}/payments?status=pending_approval`}
        label="Payments awaiting approval"
        value={pendingPayments}
        warning
      />,
    );

  if (boxes.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-base font-semibold text-text">Market trucks</h2>
      <KpiGrid>{boxes}</KpiGrid>
    </section>
  );
}

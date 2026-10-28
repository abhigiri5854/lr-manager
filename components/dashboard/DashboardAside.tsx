import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { cx } from "@/lib/cx";
import { formatDate, formatRupeesShort } from "@/lib/format";
import { chargedAsLabel, joinAnd, paymentModeLabel } from "@/lib/labels";
import type { AttentionItem, RepeatRoute } from "@/lib/types";

const MAX_ATTENTION = 8;

function Note({ warning, children }: { warning?: boolean; children: ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-control p-3",
        warning ? "bg-warning-soft text-warning" : "bg-surface-muted text-text-strong",
      )}
    >
      {children}
    </div>
  );
}

function AttentionNote({ item }: { item: AttentionItem }) {
  switch (item.kind) {
    case "eway_expired":
    case "eway_expiring":
      return (
        <Note warning>
          <b>E-way bill {item.ewayBillNo}</b> (LR {item.lrNo}){" "}
          {item.kind === "eway_expired"
            ? `expired ${formatDate(item.expiresAt)} — extend or record delivery.`
            : `expires ${formatDate(item.expiresAt)} — extend before expiry.`}{" "}
          <Link href={`/lr/${item.lrId}`}>Open LR</Link>
        </Note>
      );
    case "pod_overdue": {
      const penalty =
        item.penaltyPerDayPaise !== null
          ? `, ${formatRupeesShort(item.penaltyPaise)} penalty so far (${formatRupeesShort(item.penaltyPerDayPaise)}/day)`
          : "";
      return (
        <Note warning>
          <b>POD for LR {item.lrNo}</b> — {item.daysOverdue} day{item.daysOverdue === 1 ? "" : "s"}{" "}
          past the {item.podDays}-day limit{penalty}.{" "}
          <Link href={`/lr/${item.lrId}/pod`}>Record POD</Link>
        </Note>
      );
    }
    case "doc_expiry": {
      const when =
        item.daysLeft < 0
          ? `expired ${formatDate(item.expiresOn)}`
          : item.daysLeft === 0
            ? "expires today"
            : `expires ${formatDate(item.expiresOn)} (${item.daysLeft} day${item.daysLeft === 1 ? "" : "s"} left)`;
      return (
        <Note warning>
          <b>
            {item.doc} for {item.owner === "truck" ? "truck " : "driver "}
            {item.ownerLabel}
          </b>{" "}
          {when} — update it. <Link href="/trucks">Open Trucks &amp; drivers</Link>
        </Note>
      );
    }
    case "draft_incomplete":
      return (
        <Note>
          <b>Draft LR {item.lrNo}</b> — {joinAnd(item.missing)} still empty.{" "}
          <Link href={`/lr/${item.lrId}/edit`}>Finish</Link>
        </Note>
      );
  }
}

function AttentionCard({ children }: { children: ReactNode }) {
  return (
    <Card heading="large" title="Needs attention">
      <div className="flex flex-col gap-3 text-sm leading-normal">{children}</div>
    </Card>
  );
}

export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const shown = items.slice(0, MAX_ATTENTION);
  const hidden = items.length - shown.length;
  return (
    <AttentionCard>
      {shown.length === 0 ? (
        <p className="m-0 text-muted">Nothing needs attention right now.</p>
      ) : (
        shown.map((item, i) => <AttentionNote key={`${item.kind}:${i}`} item={item} />)
      )}
      {hidden > 0 && (
        <p className="m-0 text-muted">
          {hidden} more not shown. <Link href="/lr">Open register</Link>
        </p>
      )}
    </AttentionCard>
  );
}

function routeLine(r: RepeatRoute): string {
  const route = r.fromPlace || r.toPlace ? `${r.fromPlace ?? "—"} → ${r.toPlace ?? "—"}` : null;
  return [
    route,
    r.chargedAs && chargedAsLabel[r.chargedAs],
    r.paymentMode && paymentModeLabel[r.paymentMode],
    `last used ${formatDate(r.lastUsedOn)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function RepeatCard({ children }: { children: ReactNode }) {
  return (
    <Card heading="large" title="One-click repeat">
      <div className="flex flex-col gap-2">{children}</div>
    </Card>
  );
}

export function OneClickRepeat({ routes }: { routes: RepeatRoute[] }) {
  return (
    <RepeatCard>
      {routes.length === 0 ? (
        <p className="m-0 text-sm leading-normal text-muted">
          Your most used consignor → consignee pairs will show here after your first LRs.
        </p>
      ) : (
        routes.map((r) => (
          <Link
            key={r.lrId}
            href={`/lr/new?from=${r.lrId}`}
            className="block rounded-control border border-border p-3 text-sm leading-normal text-text no-underline hover:bg-surface-subtle hover:text-text"
          >
            <b>
              {r.consignorName} → {r.consigneeName}
            </b>
            <br />
            <span className="text-muted">{routeLine(r)}</span>
          </Link>
        ))
      )}
    </RepeatCard>
  );
}

/** Right-hand column: wraps under the table when there isn't room. */
export function DashboardAside({ children }: { children: ReactNode }) {
  return <aside className="flex flex-[1_1_320px] flex-col gap-4">{children}</aside>;
}

export function DashboardAsideLoading() {
  const loading = <p className="m-0 text-sm text-muted">Loading…</p>;
  return (
    <DashboardAside>
      <AttentionCard>{loading}</AttentionCard>
      <RepeatCard>{loading}</RepeatCard>
    </DashboardAside>
  );
}

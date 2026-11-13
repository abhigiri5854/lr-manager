import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import type { TruckPartyProfile, TruckPartyProfileChallan, TruckPartyProfilePayment } from "@/lib/data/truck-party-profile";
import { formatDate, formatRupees } from "@/lib/format";
import type { TruckPaymentMode, TruckPaymentStatus } from "@/lib/types";
import { paymentModeLabel, paymentStatusLabel } from "./labels";

export const PROFILE_TABS = [
  { key: "challans", label: "Challans" },
  { key: "payments", label: "Payments" },
] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number]["key"];

export function parseProfileTab(raw: string | string[] | undefined): ProfileTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return PROFILE_TABS.find((t) => t.key === v)?.key ?? "challans";
}

export function SummaryCards({ profile }: { profile: TruckPartyProfile }) {
  const cards = [
    { label: `Trips this FY (${profile.fy})`, value: String(profile.tripsThisFy) },
    { label: "Balance outstanding", value: formatRupees(profile.balancePaise) },
    {
      label: "Last payment",
      value: profile.lastPayment ? formatRupees(profile.lastPayment.amountPaise) : "—",
      note: profile.lastPayment ? formatDate(profile.lastPayment.paidOn) : "No payment yet",
    },
  ];
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <div className="text-[13px] text-muted">{c.label}</div>
          <div className="mt-1 text-xl font-semibold text-text-strong">{c.value}</div>
          {c.note && <div className="mt-0.5 text-[13px] text-muted">{c.note}</div>}
        </Card>
      ))}
    </div>
  );
}

export function ProfileTabNav({ partyId, active }: { partyId: string; active: ProfileTab }) {
  return (
    <nav aria-label="Party history" className="mb-4 flex flex-wrap gap-2">
      {PROFILE_TABS.map((t) => (
        <Link
          key={t.key}
          href={`/market-trucks/parties/${partyId}?tab=${t.key}`}
          aria-current={t.key === active ? "page" : undefined}
          className={
            t.key === active
              ? "inline-flex min-h-control items-center rounded-control bg-primary-soft px-4 text-sm font-semibold text-primary"
              : "inline-flex min-h-control items-center rounded-control border border-border bg-surface px-4 text-sm text-muted"
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

const challanColumns: Column<TruckPartyProfileChallan>[] = [
  {
    key: "no",
    header: "Challan",
    cell: (r) => <Link href={`/market-trucks/challans/${r.id}`}>{r.challanNo}</Link>,
    mono: true,
    sticky: true,
  },
  { key: "date", header: "Date", cell: (r) => formatDate(r.date) },
  { key: "vehicle", header: "Vehicle", cell: (r) => r.vehicleNo ?? "—", mono: true },
  {
    key: "route",
    header: "Route",
    cell: (r) => [r.source, r.destination].filter(Boolean).join(" → ") || "—",
    wrap: true,
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => <Chip tone={r.status === "draft" ? "amber" : "green"}>{r.status.replace("_", " ")}</Chip>,
  },
  { key: "hire", header: "Hire", cell: (r) => formatRupees(r.hirePaise), align: "right" },
  { key: "paid", header: "Paid", cell: (r) => formatRupees(r.paidPaise), align: "right" },
  { key: "balance", header: "Balance", cell: (r) => formatRupees(r.balancePaise), align: "right" },
];

const paymentColumns: Column<TruckPartyProfilePayment>[] = [
  {
    key: "no",
    header: "Voucher",
    cell: (r) => <Link href={`/market-trucks/payments/${r.id}`}>{r.paymentNo ?? "Draft"}</Link>,
    mono: true,
    sticky: true,
  },
  { key: "date", header: "Date", cell: (r) => formatDate(r.paidOn) },
  { key: "mode", header: "Mode", cell: (r) => paymentModeLabel[r.mode as TruckPaymentMode] ?? r.mode },
  {
    key: "status",
    header: "Status",
    cell: (r) => {
      const label = paymentStatusLabel[r.status as TruckPaymentStatus] ?? r.status;
      return <Chip tone={r.status === "paid" ? "green" : r.status === "reversed" ? "red" : "amber"}>{label}</Chip>;
    },
  },
  { key: "challans", header: "Challans", cell: (r) => r.challanNos.join(", ") || "—", mono: true, wrap: true },
  { key: "net", header: "Net paid", cell: (r) => formatRupees(r.netPaise), align: "right" },
  { key: "tds", header: "TDS", cell: (r) => formatRupees(r.tdsPaise), align: "right" },
];

export function ProfileTable({ profile, tab }: { profile: TruckPartyProfile; tab: ProfileTab }) {
  return (
    <Card padding="table">
      {tab === "challans" ? (
        <DataTable
          label="Challans"
          columns={challanColumns}
          rows={profile.challans}
          rowKey={(r) => r.id}
          empty="No challans for this party yet."
        />
      ) : (
        <DataTable
          label="Payments"
          columns={paymentColumns}
          rows={profile.payments}
          rowKey={(r) => r.id}
          empty="No payments to this party yet."
        />
      )}
    </Card>
  );
}

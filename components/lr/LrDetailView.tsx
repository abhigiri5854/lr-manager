import Link from "next/link";
import { LrStatusChip } from "@/components/LrStatusChip";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cx } from "@/lib/cx";
import { Chip } from "@/components/ui/Chip";
import { PageHeader } from "@/components/ui/PageHeader";
import type { LrDetail } from "@/lib/data/lr-detail";
import { formatDate, formatRupees } from "@/lib/format";
import { chargedAsLabel, joinAnd, paymentModeLabel } from "@/lib/labels";
import { lrChargeBreakdown, lrTotalWeight } from "@/lib/lr-charges";
import { ewayUrgency } from "@/lib/lr-status";
import type { GstPayer } from "@/lib/types";
import { CANCELLABLE, lrPrimaryAction } from "./LrActions";
import { DetailRow, DocTile } from "./LrDetailParts";
import { LrRowMenu } from "./LrRowMenu";
import { LrTimeline } from "./LrTimeline";
import { IfCan } from "@/components/ui/Permissions";

const gstPayerLabel: Record<GstPayer, string> = {
  consignor: "Consignor",
  consignee: "Consignee",
  transporter: "Transporter",
};

const dash = (v: string | null | undefined) => v || "—";
const nameOf = (p: LrDetail["consignor"]) => p?.name ?? "—";

function Alerts({ detail, nowMs }: { detail: LrDetail; nowMs: number }) {
  const { lr, podOverdue } = detail;
  return (
    <>
      {lr.lrInvoices.map((inv) => {
        const urgency = ewayUrgency(lr.status, inv.ewayExpiresAt, nowMs);
        if (!urgency || !inv.ewayExpiresAt) return null;
        const what = inv.ewayBillNo ?? `for invoice ${inv.invoiceNo}`;
        const when = formatDate(inv.ewayExpiresAt);
        return (
          <Alert
            key={inv.id}
            tone="warning"
            title={
              urgency === "expired"
                ? `E-way bill ${what} expired on ${when}.`
                : `E-way bill ${what} expires on ${when} (within 24 hours).`
            }
          >
            {urgency === "expired"
              ? "If goods are still moving, extend it on the e-way portal; if delivered, record the POD."
              : "If the goods are still on the road, extend it on the e-way portal before it lapses."}
          </Alert>
        );
      })}
      {podOverdue && lr.deliveredAt && (
        <Alert
          tone="warning"
          title={`POD is ${podOverdue.daysOverdue} ${podOverdue.daysOverdue === 1 ? "day" : "days"} overdue.`}
        >
          Delivered {formatDate(lr.deliveredAt)}; the signed copy was due within {detail.podDays}{" "}
          days.
          {detail.podPenaltyPerDayPaise !== null &&
            ` Penalty so far ${formatRupees(podOverdue.penaltyPaise)} (${formatRupees(detail.podPenaltyPerDayPaise)} a day).`}
        </Alert>
      )}
    </>
  );
}

function PartiesCard({ detail }: { detail: LrDetail }) {
  const { lr, consignor, consignee, billedTo } = detail;
  return (
    <Card title="Parties" className="min-w-0 flex-[1_1_380px]">
      <DetailRow label="Consignor">{nameOf(consignor)}</DetailRow>
      <DetailRow label="Consignor GSTIN" mono>
        {dash(consignor?.gstin)}
      </DetailRow>
      <DetailRow label="Consignee">{nameOf(consignee)}</DetailRow>
      <DetailRow label="Consignee GSTIN" mono>
        {dash(consignee?.gstin)}
      </DetailRow>
      <DetailRow label="Billed to">
        {billedTo?.sameAsConsignee ? `${billedTo.name} (same as consignee)` : nameOf(billedTo)}
      </DetailRow>
      <DetailRow label="Billed to GSTIN" mono>
        {dash(billedTo?.gstin)}
      </DetailRow>
      <DetailRow label="GST paid by">{lr.gstPaidBy ? gstPayerLabel[lr.gstPaidBy] : "—"}</DetailRow>
      <DetailRow label="Payment">
        {lr.paymentMode ? paymentModeLabel[lr.paymentMode] : "—"}
      </DetailRow>
    </Card>
  );
}

/** Goods as a compact table: item, packages, weight / size, then the totals. */
function GoodsTable({ items }: { items: LrDetail["lr"]["items"] }) {
  if (items.length === 0) return <DetailRow label="Goods">—</DetailRow>;
  const th = "border-b border-border py-2 text-[13px] font-semibold text-muted";
  const td = "border-b border-border-row py-2 align-top";
  const packages = items.reduce((sum, i) => sum + i.packages, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            <th className={th}>Item</th>
            <th className={cx(th, "px-3 text-right")}>Pkgs</th>
            <th className={cx(th, "text-right")}>Weight / size</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className={td}>{item.description}</td>
              <td className={cx(td, "px-3 text-right")}>{item.packages}</td>
              <td className={cx(td, "text-right")}>
                {[item.size, item.chargedWeight ?? item.actualWeight].filter(Boolean).join(" · ") ||
                  "—"}
              </td>
            </tr>
          ))}
        </tbody>
        {
          <tfoot>
            <tr className="font-semibold">
              <td className="border-b border-border-row py-2">Total</td>
              <td className="border-b border-border-row px-3 py-2 text-right">{packages}</td>
              <td className="border-b border-border-row py-2 text-right">
                {lrTotalWeight(items) ?? "—"}
              </td>
            </tr>
          </tfoot>
        }
      </table>
    </div>
  );
}

function ShipmentCard({ detail, nowMs }: { detail: LrDetail; nowMs: number }) {
  const { lr, driver, invoices } = detail;
  const charges = lrChargeBreakdown(lr.charges, lr.gstPaidBy);
  return (
    <Card title="Shipment" className="min-w-0 flex-[1_1_380px]">
      <GoodsTable items={lr.items} />
      <DetailRow label="Charged as">{lr.chargedAs ? chargedAsLabel[lr.chargedAs] : "—"}</DetailRow>
      <DetailRow label="Value">
        {lr.totalValuePaise === null ? "—" : formatRupees(lr.totalValuePaise)}
      </DetailRow>
      {invoices.length === 0 ? (
        <>
          <DetailRow label="Goods invoice">—</DetailRow>
          <DetailRow label="E-way bill">—</DetailRow>
        </>
      ) : (
        invoices.map((inv, i) => {
          const urgency = ewayUrgency(lr.status, inv.ewayExpiresAt, nowMs);
          return (
            <div key={i}>
              <DetailRow label="Goods invoice">
                {inv.invoiceNo}
                {inv.invoiceDate && ` · ${formatDate(inv.invoiceDate)}`}
              </DetailRow>
              <DetailRow label="E-way bill">
                {inv.ewayBillNo ? (
                  <>
                    <span className="font-mono font-medium">{inv.ewayBillNo}</span>
                    {inv.ewayExpiresAt && (
                      <span className="mt-0.5 block text-xs font-normal text-muted">
                        valid till {formatDate(inv.ewayExpiresAt)}{" "}
                        {urgency === "expired" && (
                          <Chip tone="red" className="px-2 py-0.5">
                            Expired
                          </Chip>
                        )}
                        {urgency === "expiring" && (
                          <Chip tone="amber" className="px-2 py-0.5">
                            ≤24h
                          </Chip>
                        )}
                      </span>
                    )}
                  </>
                ) : (
                  "Not entered"
                )}
              </DetailRow>
            </div>
          );
        })
      )}
      <DetailRow label="Truck / driver">
        {lr.truckNumber || driver ? (
          <>
            <span className="font-mono font-medium">{dash(lr.truckNumber)}</span>
            {driver && ` · ${driver.name ? `${driver.name} ` : ""}${driver.mobile}`}
          </>
        ) : (
          "—"
        )}
      </DetailRow>
      {charges.empty ? (
        <DetailRow label="Freight">
          Not entered
          {lr.status !== "Cancelled" && (
            <IfCan action="lr.edit">
              {" · "}
              <Link href={`/lr/${lr.id}/edit#freight`}>Add freight</Link>
            </IfCan>
          )}
        </DetailRow>
      ) : (
        <>
          {charges.lines.map((l) => (
            <DetailRow key={l.key} label={l.label}>
              {formatRupees(l.paise)}
            </DetailRow>
          ))}
          <DetailRow label="Total">{formatRupees(charges.totalPaise)}</DetailRow>
          {charges.advancePaise > 0 && (
            <DetailRow label="Advance">{formatRupees(charges.advancePaise)}</DetailRow>
          )}
          <DetailRow label="Balance">{formatRupees(charges.balancePaise)}</DetailRow>
        </>
      )}
    </Card>
  );
}

function DocumentsCard({ detail }: { detail: LrDetail }) {
  const { lr, invoices, pod, bill, lrCopies } = detail;
  const canPrint = lr.status !== "Draft" && lr.status !== "Cancelled";
  return (
    <Card title="Linked documents" className="min-w-0 flex-[1_1_300px]">
      <div className="flex flex-col gap-2.5">
        {canPrint ? (
          <DocTile
            href={`/pdf/lr/${lr.id}`}
            newTab
            title="LR PDF"
            note={`${lrCopies.length} ${lrCopies.length === 1 ? "copy" : "copies"}`}
          >
            {joinAnd(lrCopies.map((c) => c.toLowerCase()))}
          </DocTile>
        ) : (
          <DocTile title="LR PDF" note="not yet">
            {lr.status === "Draft" ? "available once the LR is booked" : "LR was cancelled"}
          </DocTile>
        )}
        {invoices.length === 0 ? (
          <DocTile title="Goods invoice" note="not yet" />
        ) : (
          invoices.map((inv) => (
            <DocTile
              key={inv.id}
              href={inv.taxInvoice ? `/invoices/${inv.taxInvoice.id}` : undefined}
              title={`Goods invoice ${inv.invoiceNo}`}
              note={inv.invoiceDate ? formatDate(inv.invoiceDate) : undefined}
              action={
                inv.taxInvoice?.hasSourceFile ? undefined : (
                  <IfCan action="import.run">
                    <Link href={`/import?lr=${lr.id}`}>Attach</Link>
                  </IfCan>
                )
              }
            >
              {inv.taxInvoice?.hasSourceFile ? "source file attached" : "no copy attached"}
            </DocTile>
          ))
        )}
        <DocTile
          href={`/lr/${lr.id}/pod`}
          title="POD"
          note={pod?.receivedAt ? `received ${formatDate(pod.receivedAt)}` : "not yet received"}
        />
        <DocTile
          href="/bills"
          title="Freight bill"
          note={bill ? `${bill.billNo ?? "draft"} · ${formatDate(bill.billDate)}` : "not billed"}
        />
      </div>
      <h3 className="mt-4 mb-1.5 text-[15px] font-bold">Activity</h3>
      <ul className="m-0 list-none p-0 text-[13px] leading-[1.7] text-muted">
        {detail.activity.map((a) => (
          <li key={a.id}>
            {formatDate(a.at)} · {a.text}
            {a.by && ` · ${a.by}`}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function LrDetailView({ detail, nowMs }: { detail: LrDetail; nowMs: number }) {
  const { lr } = detail;
  const primary = lrPrimaryAction(lr);
  const pdfReady = lr.status !== "Draft" && lr.status !== "Cancelled";
  const route = lr.fromPlace || lr.toPlace ? `${dash(lr.fromPlace)} → ${dash(lr.toPlace)}` : null;
  const subtitle = [
    lr.lrDate ? formatDate(lr.lrDate) : "No date",
    detail.consignor || detail.consignee
      ? `${nameOf(detail.consignor)} → ${nameOf(detail.consignee)}`
      : null,
    route,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "LR register", href: "/lr" }, { label: `LR ${lr.lrNo}` }]}
        title={
          <>
            LR <span className="font-mono font-medium text-primary">{lr.lrNo}</span>{" "}
            <span className="align-middle text-base">
              <LrStatusChip status={lr.status} />
            </span>
          </>
        }
        subtitle={subtitle}
        actions={
          <>
            <IfCan action="lr.edit">
              <Button
                variant="secondary"
                href={`/lr/${lr.id}/edit`}
                disabled={lr.status === "Cancelled"}
              >
                Edit
              </Button>
            </IfCan>
            <Button variant="secondary" href={`/pdf/lr/${lr.id}`} newTab disabled={!pdfReady}>
              Preview PDF
            </Button>
            <Button variant="secondary" href={`/pdf/lr/${lr.id}`} download disabled={!pdfReady}>
              Download PDF
            </Button>
            {primary && (
              <IfCan action={primary.action}>
                <Button variant="dark" href={primary.href}>
                  {primary.label}
                </Button>
              </IfCan>
            )}
            <LrRowMenu
              lrId={lr.id}
              lrNo={lr.lrNo}
              canPrint={pdfReady}
              canCancel={CANCELLABLE.includes(lr.status)}
            />
          </>
        }
      />
      {lr.status === "Cancelled" && (
        <Alert tone="warning" title="This LR was cancelled.">
          {lr.cancelReason && `Reason: ${lr.cancelReason}. `}It stays in the register and its number
          is not reused.
        </Alert>
      )}
      <Alerts detail={detail} nowMs={nowMs} />
      <LrTimeline detail={detail} />
      <div className="flex flex-wrap items-start gap-5">
        <PartiesCard detail={detail} />
        <ShipmentCard detail={detail} nowMs={nowMs} />
        <DocumentsCard detail={detail} />
      </div>
    </>
  );
}

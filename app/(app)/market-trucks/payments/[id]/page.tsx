import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PaymentActions } from "@/components/market-trucks/PaymentRowActions";
import { PAYMENT_STATUS_TONE } from "@/components/market-trucks/PaymentRegister";
import { paymentModeLabel, paymentStatusLabel } from "@/components/market-trucks/labels";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { NoAccess } from "@/components/ui/NoAccess";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { getCompany } from "@/lib/data/companies";
import { getActiveCompanyId, getActiveRole } from "@/lib/data/session";
import { getTruckPayment } from "@/lib/data/truck-payments";
import { todayInIndia } from "@/lib/fy";
import { formatDate, formatPaise, formatPercent } from "@/lib/format";
import { toPaise } from "@/lib/hire";
import { can } from "@/lib/permissions";
import { paymentShareText, whatsappLink } from "@/lib/truck-payment-share";

export const metadata: Metadata = { title: "Truck payment" };

const rupees = (v: string) => `₹${formatPaise(toPaise(v))}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-semibold text-text">{children}</span>
    </div>
  );
}

async function Payment({ params }: Pick<PageProps<"/market-trucks/payments/[id]">, "params">) {
  const role = await getActiveRole();
  if (!can(role, "freight.view")) {
    return (
      <NoAccess
        title="Truck payment"
        role={role}
        action="freight.view"
        back={{ href: "/", label: "Back to the dashboard" }}
      />
    );
  }
  const { id } = await params;
  const companyId = await getActiveCompanyId();
  const [p, company] = await Promise.all([getTruckPayment(companyId, id), getCompany(companyId)]);
  if (!p || p.cancelledAt) notFound();
  const mobile = typeof p.payeeSnapshot?.mobile === "string" ? p.payeeSnapshot.mobile : null;
  const share = whatsappLink(paymentShareText(p, company?.name), mobile);
  return (
    <>
      <PageHeader
        title={
          <>
            Payment <span className="font-mono">{p.paymentNo ?? "(no voucher yet)"}</span>{" "}
            <Chip tone={PAYMENT_STATUS_TONE[p.status]}>{paymentStatusLabel[p.status]}</Chip>
          </>
        }
        breadcrumb={[{ label: "Truck payments", href: "/market-trucks/payments" }, { label: p.paymentNo ?? "Payment" }]}
        breadcrumbPlacement="inline"
        actions={
          <>
            <Button href={share} newTab variant="outline">
              Share on WhatsApp
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-5">
        {p.status === "pending_approval" && (
          <Alert tone="warning" title="Waiting for approval.">
            Someone with approval rights needs to approve this before it can be paid.
          </Alert>
        )}
        {p.warnings.length > 0 && (
          <Alert tone="warning" title="Please note:">
            <ul className="m-0 mt-1 list-disc pl-5">
              {p.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </Alert>
        )}
        {p.status === "reversed" && (
          <Alert tone="warning" title="Reversed.">
            {p.reversalReason}
          </Alert>
        )}
        <Card title="Actions">
          <PaymentActions payment={p} today={todayInIndia()} showOpen={false} />
        </Card>
        <Card title="Payment">
          <Row label="Paid to">{p.payeeName ?? "—"}</Row>
          <Row label="Date">{formatDate(p.paidOn)}</Row>
          <Row label="Mode">{paymentModeLabel[p.mode]}</Row>
          <Row label="Reference">{p.refNo ?? "—"}</Row>
          {p.chequeDate && <Row label="Cheque date">{formatDate(p.chequeDate)}</Row>}
          <Row label="Amount">{rupees(p.grossAmount)}</Row>
          <Row label={`TDS${Number(p.tdsPercent) > 0 ? ` (${formatPercent(p.tdsPercent)}%)` : ""}`}>{rupees(p.tdsAmount)}</Row>
          <Row label="Net paid">{rupees(p.amount)}</Row>
          {p.podOverrideReason && <Row label="Balance before POD">{p.podOverrideReason}</Row>}
          {p.narration && <Row label="Note">{p.narration}</Row>}
        </Card>
        <Card title="Challans">
          {p.allocations.map((a) => (
            <Row key={a.id} label={`${a.challanNo} · ${a.kind === "advance" ? "Advance" : "Balance"}`}>
              ₹{formatPaise(toPaise(a.amount) + toPaise(a.tdsAmount))}
              {toPaise(a.tdsAmount) > 0 && <> (TDS {rupees(a.tdsAmount)})</>}
            </Row>
          ))}
        </Card>
      </div>
    </>
  );
}

export default function PaymentPage({ params }: PageProps<"/market-trucks/payments/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Payment params={params} />
    </Suspense>
  );
}

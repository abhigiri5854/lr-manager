import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import type { TruckPaymentRow } from "@/lib/data/truck-payments";
import { formatDate, formatPaise } from "@/lib/format";
import { toPaise } from "@/lib/hire";
import { PAYMENT_STATUS_TONE } from "./PaymentRegister";
import { paymentModeLabel, paymentStatusLabel } from "./labels";

/** Small "Payments" section on the challan page: what was paid against it, and a link to record more. */
export function ChallanPayments({
  challanId,
  payments,
  canRecord,
}: {
  challanId: string;
  payments: TruckPaymentRow[];
  canRecord: boolean;
}) {
  return (
    <Card
      title="Payments"
      description="Optional: record advances and balance paid to the owner or broker."
      action={
        canRecord ? (
          <Button href={`/market-trucks/payments/new?challanId=${challanId}`} variant="secondary">
            Record payment
          </Button>
        ) : undefined
      }
    >
      {payments.length === 0 ? (
        <p className="m-0 text-sm text-muted">No payment recorded for this challan.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {payments.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5 text-sm last:border-0"
            >
              <span>
                <Link href={`/market-trucks/payments/${p.id}`} className="font-mono font-semibold">
                  {p.paymentNo ?? "Draft"}
                </Link>{" "}
                <span className="text-muted">
                  · {formatDate(p.paidOn)} · {paymentModeLabel[p.mode]}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <b>₹{formatPaise(toPaise(p.amount))}</b>
                <Chip tone={PAYMENT_STATUS_TONE[p.status]}>{paymentStatusLabel[p.status]}</Chip>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

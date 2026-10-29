import { Card } from "@/components/ui/Card";
import { IfCan } from "@/components/ui/Permissions";
import { PaymentForm, type PaymentPartyOption } from "./PaymentForm";

/** "Record a payment" card beside the dues table on /bills. */
export function RecordPaymentCard({ parties }: { parties: PaymentPartyOption[] }) {
  return (
    <Card title="Record a payment">
      <IfCan
        action="bill.edit"
        fallback={<p className="m-0 text-sm text-muted">Your role can view payments but not record them.</p>}
      >
        <PaymentForm parties={parties} />
      </IfCan>
    </Card>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approvePaymentAction,
  markPaymentPaidAction,
  reversePaymentAction,
  submitPaymentAction,
} from "@/app/(app)/market-trucks/payments/actions";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Textarea } from "@/components/ui/Field";
import { useCan } from "@/components/ui/Permissions";
import type { TruckPaymentMode, TruckPaymentStatus } from "@/lib/types";

type Target = {
  id: string;
  version: number;
  status: TruckPaymentStatus;
  mode: TruckPaymentMode;
  refNo: string | null;
};

/**
 * The actions a payment allows right now: Open, Submit (draft), Approve (payment.approve),
 * Mark paid, Reverse (payment.approve) and Print. Used by the list rows and the payment page.
 */
export function PaymentActions({
  payment,
  today,
  showOpen = true,
}: {
  payment: Target;
  /** Today in India (yyyy-mm-dd), the default paid date. */
  today: string;
  showOpen?: boolean;
}) {
  const router = useRouter();
  const canEdit = useCan("bill.edit");
  const canApprove = useCan("payment.approve");
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"paid" | "reverse" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState(today);
  const [refNo, setRefNo] = useState(payment.refNo ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const s = payment.status;
  const needsRef = payment.mode === "bank" || payment.mode === "upi";

  function run(
    call: () => Promise<{ ok: true } | { ok: false; message: string }>,
    onFail: (m: string) => void,
  ) {
    startTransition(async () => {
      const r = await call();
      if (r.ok) {
        setDialog(null);
        router.refresh();
      } else onFail(r.message);
    });
  }

  return (
    <div className="relative z-10 flex flex-wrap justify-end gap-2">
      {showOpen && (
        <Button href={`/market-trucks/payments/${payment.id}`} variant="secondary" className="px-3">
          Open
        </Button>
      )}
      {s === "draft" && canEdit && (
        <Button
          variant="secondary"
          className="px-3"
          disabled={pending}
          onClick={() => run(() => submitPaymentAction(payment.id, payment.version), setMessage)}
        >
          Submit
        </Button>
      )}
      {s === "pending_approval" && canApprove && (
        <Button
          className="px-3"
          disabled={pending}
          onClick={() => run(() => approvePaymentAction(payment.id, payment.version), setMessage)}
        >
          Approve
        </Button>
      )}
      {s === "approved" && canEdit && (
        <Button className="px-3" onClick={() => (setError(null), setDialog("paid"))}>
          Mark paid
        </Button>
      )}
      {(s === "approved" || s === "paid") && canApprove && (
        <Button variant="secondary" className="px-3" onClick={() => (setError(null), setDialog("reverse"))}>
          Reverse
        </Button>
      )}
      <Button href={`/pdf/payment/${payment.id}`} newTab variant="secondary" className="px-3">
        Print
      </Button>

      <Dialog open={message !== null} onClose={() => setMessage(null)} title="Couldn't complete this">
        <p className="m-0 text-sm">{message}</p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setMessage(null)}>
            Close
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={dialog === "paid"}
        onClose={() => setDialog(null)}
        title="Mark as paid"
        description={needsRef ? "Enter the UTR / transaction reference." : "The reference is optional for this mode."}
      >
        <div className="flex flex-col gap-3 text-left">
          <DateField label="Paid on" value={paidOn} onChange={setPaidOn} />
          <Field
            label={needsRef ? "UTR / reference" : "Cheque / slip no. (optional)"}
            value={refNo}
            onChange={(e) => setRefNo(e.target.value)}
            error={error}
            autoComplete="off"
          />
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () => markPaymentPaidAction(payment.id, payment.version, { paidOn, refNo }),
                setError,
              )
            }
          >
            {pending ? "Saving…" : "Mark paid"}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={dialog === "reverse"}
        onClose={() => setDialog(null)}
        title="Reverse this payment"
        description="The amounts stop counting against the challans. This can't be undone."
      >
        <Textarea
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={error}
        />
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => run(() => reversePaymentAction(payment.id, payment.version, { reason }), setError)}
          >
            {pending ? "Reversing…" : "Reverse payment"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

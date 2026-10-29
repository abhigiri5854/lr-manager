"use client";

import { useState } from "react";
import { cancelBillAction, cancelPaymentAction, loadPaymentAction } from "@/app/(app)/bills/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IfCan } from "@/components/ui/Permissions";
import type { Payment } from "@/lib/types";
import { CancelReasonDialog } from "./CancelReasonDialog";
import { PaymentForm, type PaymentPartyOption } from "./PaymentForm";

/** Row buttons sit above the row's click overlay (see DataTable). */
const small = "relative z-10 h-9 px-3 text-[13px]";

/** Record payment / Cancel on a bills-list row. */
export function BillRowActions({
  bill,
  parties,
}: {
  bill: { id: string; billNo: string | null; partyId: string; status: string };
  parties: PaymentPartyOption[];
}) {
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const canPay = bill.status === "final" || bill.status === "part";
  const canCancel = bill.status === "draft" || bill.status === "final";

  return (
    <div className="flex gap-2">
      {canPay && (
        <IfCan action="bill.edit">
          <Button variant="outline" className={small} onClick={() => setPaying(true)}>
            Record payment
          </Button>
        </IfCan>
      )}
      {canCancel && (
        <IfCan action="record.cancel">
          <Button variant="secondary" className={small} onClick={() => setCancelling(true)}>
            Cancel
          </Button>
        </IfCan>
      )}
      <Dialog
        open={paying}
        onClose={() => setPaying(false)}
        title={`Record payment${bill.billNo ? ` · ${bill.billNo}` : ""}`}
        description="Allocated to this bill first, then the party's older bills."
      >
        <PaymentForm
          parties={parties}
          partyId={bill.partyId}
          billId={bill.id}
          onDone={() => setPaying(false)}
          onCancel={() => setPaying(false)}
        />
      </Dialog>
      <CancelReasonDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={`Cancel ${bill.billNo ?? "draft bill"}?`}
        description="Its LRs become unbilled again. A final bill's number stays used."
        confirmLabel="Cancel bill"
        onConfirm={async (reason) => {
          const r = await cancelBillAction(bill.id, reason);
          return r.ok ? null : r.message;
        }}
      />
    </div>
  );
}

/** Allocate / edit and Cancel on a payment row of the party ledger. */
export function LedgerPaymentActions({
  paymentId,
  parties,
  onAccountPaise,
}: {
  paymentId: string;
  parties: PaymentPartyOption[];
  onAccountPaise: number;
}) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    setPayment(await loadPaymentAction(paymentId));
    setLoading(false);
    setEditing(true);
  }

  return (
    <div className="flex gap-2">
      <IfCan action="bill.edit">
        <Button variant="outline" className="h-9 px-3 text-[13px]" onClick={open} disabled={loading}>
          {onAccountPaise > 0 ? "Allocate" : "Edit"}
        </Button>
      </IfCan>
      <IfCan action="record.cancel">
        <Button
          variant="secondary"
          className="h-9 px-3 text-[13px]"
          onClick={() => setCancelling(true)}
        >
          Cancel
        </Button>
      </IfCan>
      <Dialog
        open={editing && !!payment}
        onClose={() => setEditing(false)}
        title="Change payment"
        description="Amounts and allocations are checked together. Unallocated money stays on account."
      >
        <PaymentForm
          parties={parties}
          payment={payment}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </Dialog>
      <CancelReasonDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancel this payment?"
        description="Its allocations are released and the bills show as unpaid again."
        confirmLabel="Cancel payment"
        onConfirm={async (reason) => {
          const r = await cancelPaymentAction(paymentId, reason);
          return r.ok ? null : r.message;
        }}
      />
    </div>
  );
}

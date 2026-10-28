"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelPartyAction } from "@/app/(app)/parties/actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Field";

/**
 * Cancel party. When LRs or invoices still use it, the dialog explains why instead of
 * offering the button (`blockedBy` is that sentence, from the server).
 */
export function CancelPartyButton({
  partyId,
  blockedBy,
}: {
  partyId: string;
  blockedBy: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (reason.trim().length < 3) {
      setError("Give a reason (at least 3 characters)");
      return;
    }
    startTransition(async () => {
      const result = await cancelPartyAction(partyId, reason);
      if (result.ok) router.push("/parties");
      else setError(result.message);
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Cancel party
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        title="Cancel this party?"
        description={
          blockedBy ??
          "It disappears from lists and pickers. Nothing is deleted; old documents keep its details."
        }
      >
        {blockedBy ? (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Textarea
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              error={error}
            />
            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Keep party
              </Button>
              <Button variant="danger" onClick={confirm} disabled={pending}>
                {pending ? "Cancelling…" : "Cancel party"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

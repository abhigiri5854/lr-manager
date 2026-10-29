"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Field";

/** Asks for a reason, then runs `onConfirm`; it returns an error message to show, or null when done. */
export function CancelReasonDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}>
      <ReasonForm confirmLabel={confirmLabel} onClose={onClose} onConfirm={onConfirm} />
    </Dialog>
  );
}

// Mounted only while the dialog is open, so the reason starts empty each time.
function ReasonForm({
  confirmLabel,
  onClose,
  onConfirm,
}: {
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!reason.trim()) return setError("Enter a reason");
    startTransition(async () => {
      const message = await onConfirm(reason.trim());
      if (message) setError(message);
      else onClose();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Textarea
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={error}
        maxLength={300}
        rows={3}
      />
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Keep
        </Button>
        <Button variant="danger" onClick={confirm} disabled={pending}>
          {pending ? "Working…" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}

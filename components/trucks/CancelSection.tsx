"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { useCan } from "@/components/ui/Permissions";
import type { ActionFailure } from "@/lib/data/errors";

/**
 * "Cancel truck / driver" at the bottom of an edit dialog. When an undelivered LR still uses
 * the record, it shows why instead of the button (`blockedBy` comes from the server).
 */
export function CancelSection({
  what,
  blockedBy,
  onCancel,
  onDone,
}: {
  what: "truck" | "driver";
  blockedBy: string | null;
  onCancel: () => Promise<{ ok: true } | ActionFailure>;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Cancelling is Owner-only (lib/permissions.ts "record.cancel").
  const allowed = useCan("record.cancel");

  function confirm() {
    startTransition(async () => {
      const result = await onCancel();
      if (result.ok) onDone();
      else setError(result.message);
    });
  }

  if (!allowed) return null;

  return (
    <div className="mt-2 border-t border-border pt-4">
      {blockedBy ? (
        <Alert tone="warning" title={`Can't cancel this ${what}.`}>
          {blockedBy}
        </Alert>
      ) : confirming ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm text-muted">
            It disappears from lists and pickers. Nothing is deleted; old LRs keep their details.
          </p>
          {error && <div className="text-[13px] text-danger">{error}</div>}
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" onClick={confirm} disabled={pending}>
              {pending ? "Cancelling…" : `Yes, cancel ${what}`}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep {what}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Cancel {what}
        </Button>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { commitBatchAction } from "@/app/(app)/import/actions";
import { Button } from "@/components/ui/Button";

/** "Import valid rows" in the page header. Nothing is saved before this is pressed. */
export function CommitButton({
  batchId,
  importable,
  reason,
}: {
  batchId: string | null;
  importable: number;
  /** Why it can't be pressed right now (shown as the tooltip), or null when it can. */
  reason: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const disabled = reason !== null || !batchId || pending;
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        variant="dark"
        disabled={disabled}
        title={reason ?? undefined}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await commitBatchAction(batchId!);
            if (r.ok) router.replace(`/import?imported=${batchId}`);
            else setError(r.message);
          });
        }}
      >
        {pending
          ? "Importing…"
          : importable > 0
            ? `Import valid rows (${importable})`
            : "Import valid rows"}
      </Button>
      {error && (
        <p role="alert" className="m-0 max-w-96 text-right text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

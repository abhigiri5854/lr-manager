"use client";

import { useState, useTransition } from "react";
import { createTruckAction } from "@/app/(app)/lr/form-actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import type { TruckOption } from "@/lib/lr-form";
import { normaliseVehicleNo, vehicleNoSchema } from "@/lib/validators/common";

/** "+ Add new truck" from the LR form: saves the truck straight away and hands it back. */
export function NewTruckDialog({
  open,
  initialText,
  onClose,
  onCreated,
}: {
  open: boolean;
  initialText: string;
  onClose: () => void;
  onCreated: (truck: TruckOption) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: HTMLFormElement) {
    const number = String(new FormData(form).get("number") ?? "");
    const parsed = vehicleNoSchema.safeParse(number);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the truck number");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createTruckAction({ number });
      if (result.ok) onCreated(result.truck);
      else setError(result.message);
    });
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title="New truck"
      description="Saved to Trucks & drivers now. Documents and driver can be added there later."
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
        className="flex flex-col gap-4"
      >
        <Field
          label="Truck no."
          name="number"
          required
          autoFocus
          autoCapitalize="characters"
          placeholder="BR01GN8331"
          defaultValue={normaliseVehicleNo(initialText)}
          className="[&_input]:font-mono"
          error={error}
        />
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save truck"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

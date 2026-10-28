"use client";

import { useState, useTransition } from "react";
import { createPartyAction } from "@/app/(app)/lr/form-actions";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Textarea } from "@/components/ui/Field";
import type { PartyOption } from "@/lib/lr-form";
import { normaliseGstin } from "@/lib/validators/common";
import { partyFields, type PartyInput } from "@/lib/validators/party";

/** "10aabca7061k2zz" typed into the picker goes into GSTIN; anything else is the name. */
function looksLikeGstin(text: string) {
  return /^\d{2}[A-Z0-9]{13}$/.test(normaliseGstin(text));
}

/** "+ Add new party" from the LR form: saves the party straight away and hands it back. */
export function NewPartyDialog({
  open,
  role,
  initialText,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** "consignor" / "consignee" / "billed-to party", for the title. */
  role: string;
  initialText: string;
  onClose: () => void;
  onCreated: (party: PartyOption) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const gstinFirst = looksLikeGstin(initialText);

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const input: PartyInput = {
      name: String(data.get("name") ?? ""),
      place: String(data.get("place") ?? ""),
      gstin: String(data.get("gstin") ?? ""),
      phone: String(data.get("phone") ?? ""),
      address: String(data.get("address") ?? ""),
    };
    const parsed = partyFields.safeParse(input);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await createPartyAction(input);
      if (result.ok) {
        onCreated(result.party);
        return;
      }
      if (result.kind === "validation") {
        const byField = Object.fromEntries(result.issues.map((i) => [i.path, i.message]));
        setErrors(byField);
        if (result.issues.some((i) => !i.path)) setFormError(result.message);
      } else setFormError(result.message);
    });
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        setErrors({});
        setFormError(null);
        onClose();
      }}
      title={`New ${role}`}
      description="Saved to Parties now, so it can be picked on later LRs too."
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
          label="Name"
          name="name"
          required
          autoFocus={!gstinFirst}
          defaultValue={gstinFirst ? "" : initialText}
          error={errors.name}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Place" name="place" error={errors.place} />
          <Field
            label="GSTIN"
            name="gstin"
            autoFocus={gstinFirst}
            defaultValue={gstinFirst ? normaliseGstin(initialText) : ""}
            className="[&_input]:font-mono"
            error={errors.gstin}
          />
          <Field label="Phone" name="phone" inputMode="tel" error={errors.phone} />
        </div>
        <Textarea label="Address" name="address" error={errors.address} />
        {formError && <p className="m-0 text-[13px] text-danger">{formError}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save party"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

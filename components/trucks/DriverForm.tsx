"use client";

import { useState, useTransition } from "react";
import { cancelDriverAction, saveDriverAction } from "@/app/(app)/trucks/actions";
import { Button } from "@/components/ui/Button";
import { DateField, focusFirstInvalidDate } from "@/components/ui/DateField";
import { Field } from "@/components/ui/Field";
import type { DriverRow } from "@/lib/types";
import { mobileSchema } from "@/lib/validators/common";
import { CancelSection } from "./CancelSection";

/** Add / edit driver, inside a Dialog. Editing also offers Cancel driver. */
export function DriverForm({ driver, onDone }: { driver?: DriverRow; onDone: () => void }) {
  const [mobile, setMobile] = useState(driver?.mobile ?? "");
  const [name, setName] = useState(driver?.name ?? "");
  const [licenceNo, setLicenceNo] = useState(driver?.licenceNo ?? "");
  const [licenceExpiry, setLicenceExpiry] = useState(driver?.licenceExpiry ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(form: HTMLFormElement) {
    if (focusFirstInvalidDate(form)) return;
    const parsed = mobileSchema.safeParse(mobile);
    if (!parsed.success) {
      setErrors({ mobile: parsed.error.issues[0]?.message ?? "Check the mobile number" });
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveDriverAction({
        id: driver?.id,
        expectedVersion: driver?.version,
        input: { mobile, name, licenceNo, licenceExpiry },
      });
      if (result.ok) return onDone();
      if (result.kind === "validation") {
        setErrors(Object.fromEntries(result.issues.map((i) => [i.path || "form", i.message])));
      } else {
        setErrors({ form: result.message });
      }
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="flex flex-col gap-4"
    >
      <Field
        label="Mobile"
        name="mobile"
        type="tel"
        inputMode="numeric"
        required
        autoFocus
        placeholder="10-digit number"
        value={mobile}
        onChange={(e) => setMobile(e.target.value)}
        error={errors.mobile}
      />
      <Field
        label="Name"
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        error={errors.name}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Licence no."
          name="licenceNo"
          value={licenceNo}
          onChange={(e) => setLicenceNo(e.target.value)}
          maxLength={30}
          className="[&_input]:font-mono"
          error={errors.licenceNo}
        />
        <DateField
          label="Licence expiry"
          name="licenceExpiry"
          value={licenceExpiry}
          onChange={setLicenceExpiry}
          error={errors.licenceExpiry}
        />
      </div>
      {(errors.form || errors[""]) && (
        <div className="text-[13px] text-danger">{errors.form ?? errors[""]}</div>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onDone}>
          Close
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : driver ? "Save changes" : "Save driver"}
        </Button>
      </div>
      {driver && (
        <CancelSection
          what="driver"
          blockedBy={driver.cancelBlockedBy}
          onCancel={() => cancelDriverAction(driver.id)}
          onDone={onDone}
        />
      )}
    </form>
  );
}

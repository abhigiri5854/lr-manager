"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  addMarketDriverAction,
  updateMarketDriverAction,
} from "@/app/(app)/market-trucks/drivers/actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type { MarketDriver } from "@/lib/types";
import { marketDriverFields, type MarketDriverInput } from "@/lib/validators/market-driver";
import { TruckDocInput } from "./TruckDocInput";

/**
 * Create (no `driver`) or edit a market driver. `onSaved` gets the saved driver (quick-add from the
 * challan screen); `refreshOnSave={false}` leaves the host screen's data alone.
 */
export function MarketDriverForm({
  driver,
  refreshOnSave = true,
  onSaved,
  onDone,
}: {
  driver?: MarketDriver;
  refreshOnSave?: boolean;
  onSaved?: (driver: MarketDriver) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [dlUrl, setDlUrl] = useState<string | null>(driver?.dlFileUrl ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();
  const version = useRef(driver?.version ?? 0);

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const get = (k: string) => String(data.get(k) ?? "");
    const input: MarketDriverInput = {
      name: get("name"),
      mobile: get("mobile"),
      dlNo: get("dlNo"),
      dlUpto: get("dlUpto"),
      dlFileUrl: dlUrl,
    };
    const parsed = marketDriverFields.safeParse(input);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = driver
        ? await updateMarketDriverAction(driver.id, version.current, input)
        : await addMarketDriverAction(input);
      if (result.ok) {
        version.current = result.driver.version;
        if (refreshOnSave) router.refresh();
        onSaved?.(result.driver);
        onDone();
        return;
      }
      if (result.kind === "conflict") setConflict(true);
      else if (result.kind === "validation") {
        setErrors(Object.fromEntries(result.issues.map((i) => [i.path, i.message])));
        if (result.issues.some((i) => !i.path)) setFormError(result.message);
      } else setFormError(result.message);
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="grid grid-cols-2 gap-3"
    >
      {conflict && (
        <Alert tone="warning" className="col-span-2" title="This driver was changed by someone else.">
          Close this and reopen it to see the latest details before saving again.
        </Alert>
      )}
      <Field label="Name" name="name" required defaultValue={driver?.name ?? ""} error={errors.name} className="col-span-2" />
      <Field label="Mobile" name="mobile" inputMode="tel" defaultValue={driver?.mobile ?? ""} error={errors.mobile} className="col-span-2 sm:col-span-1" />
      <Field label="Licence (DL) number" name="dlNo" defaultValue={driver?.dlNo ?? ""} error={errors.dlNo} autoCapitalize="characters" className="col-span-2 sm:col-span-1 [&_input]:font-mono [&_input]:uppercase" />
      <Field label="Licence valid upto" name="dlUpto" type="date" defaultValue={driver?.dlUpto ?? ""} error={errors.dlUpto} className="col-span-2 sm:col-span-1" />
      <div className="col-span-2 sm:col-span-1">
        <TruckDocInput label="Licence copy" kind="dl" url={dlUrl} onChange={setDlUrl} error={errors.dlFileUrl} />
      </div>

      {formError && <p className="col-span-2 m-0 text-[13px] text-danger">{formError}</p>}
      <div className="col-span-2 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : driver ? "Save changes" : "Save driver"}
        </Button>
      </div>
    </form>
  );
}

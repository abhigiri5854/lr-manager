"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cancelTruckAction, saveTruckAction, truckOwnerAction } from "@/app/(app)/trucks/actions";
import { Button } from "@/components/ui/Button";
import { DateField, focusFirstInvalidDate } from "@/components/ui/DateField";
import { Field, Select } from "@/components/ui/Field";
import type { TruckRow, TruckView } from "@/lib/types";
import { normaliseVehicleNo, vehicleNoSchema } from "@/lib/validators/common";
import { CancelSection } from "./CancelSection";

export type DriverOption = { id: string; label: string };

/** Add / edit truck, inside a Dialog. Editing also offers Cancel truck. */
export function TruckForm({
  truck,
  driverOptions,
  onDone,
}: {
  /** Omit to add a new truck. */
  truck?: TruckRow;
  driverOptions: DriverOption[];
  onDone: (saved?: TruckView) => void;
}) {
  const [number, setNumber] = useState(truck?.number ?? "");
  const [driverId, setDriverId] = useState(truck?.driverId ?? "");
  const [rc, setRc] = useState(truck?.rcExpiry ?? "");
  const [insurance, setInsurance] = useState(truck?.insuranceExpiry ?? "");
  const [permit, setPermit] = useState(truck?.permitExpiry ?? "");
  const [fitness, setFitness] = useState(truck?.fitnessExpiry ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<{ id: string; number: string } | null>(null);
  const [pending, startTransition] = useTransition();

  async function checkDuplicate(value: string) {
    const n = normaliseVehicleNo(value);
    if (!n || n === truck?.number) return setExisting(null);
    setExisting(await truckOwnerAction(n, truck?.id));
  }

  function submit(form: HTMLFormElement) {
    if (focusFirstInvalidDate(form)) return;
    const parsed = vehicleNoSchema.safeParse(number);
    if (!parsed.success) {
      setErrors({ number: parsed.error.issues[0]?.message ?? "Check the truck number" });
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveTruckAction({
        id: truck?.id,
        expectedVersion: truck?.version,
        input: {
          number,
          driverId,
          rcExpiry: rc,
          insuranceExpiry: insurance,
          permitExpiry: permit,
          fitnessExpiry: fitness,
        },
      });
      if (result.ok) return onDone(result.saved);
      if (result.kind === "validation") {
        setErrors(Object.fromEntries(result.issues.map((i) => [i.path || "form", i.message])));
        if (result.issues.some((i) => i.path === "number")) await checkDuplicate(number);
      } else {
        setErrors({ form: result.message });
      }
    });
  }

  const numberError = existing ? (
    <>
      Truck {existing.number} is already saved.{" "}
      <Link href={`/trucks?q=${existing.number}`} onClick={() => onDone()}>
        Open it
      </Link>
    </>
  ) : (
    errors.number
  );

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
        label="Truck no."
        name="number"
        required
        autoFocus
        autoCapitalize="characters"
        placeholder="BR01GN8331"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        onBlur={(e) => checkDuplicate(e.target.value)}
        className="[&_input]:font-mono"
        error={numberError}
      />
      <Select
        label="Driver"
        name="driverId"
        value={driverId}
        onChange={(e) => setDriverId(e.target.value)}
        error={errors.driverId}
      >
        <option value="">No driver</option>
        {driverOptions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </Select>
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          label="RC expiry"
          name="rcExpiry"
          value={rc}
          onChange={setRc}
          error={errors.rcExpiry}
        />
        <DateField
          label="Insurance expiry"
          name="insuranceExpiry"
          value={insurance}
          onChange={setInsurance}
          error={errors.insuranceExpiry}
        />
        <DateField
          label="Permit expiry"
          name="permitExpiry"
          value={permit}
          onChange={setPermit}
          error={errors.permitExpiry}
        />
        <DateField
          label="Fitness expiry"
          name="fitnessExpiry"
          value={fitness}
          onChange={setFitness}
          error={errors.fitnessExpiry}
        />
      </div>
      {(errors.form || errors[""]) && (
        <div className="text-[13px] text-danger">{errors.form ?? errors[""]}</div>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={() => onDone()}>
          Close
        </Button>
        <Button type="submit" disabled={pending || (!truck && existing !== null)}>
          {pending ? "Saving…" : truck ? "Save changes" : "Save truck"}
        </Button>
      </div>
      {truck && (
        <CancelSection
          what="truck"
          blockedBy={truck.cancelBlockedBy}
          onCancel={() => cancelTruckAction(truck.id)}
          onDone={() => onDone()}
        />
      )}
    </form>
  );
}

/** Just the driver link: "Assign driver" / "Change driver" from the truck row. */
export function AssignDriverForm({
  truck,
  driverOptions,
  onDone,
}: {
  truck: TruckRow;
  driverOptions: DriverOption[];
  onDone: (saved?: TruckView) => void;
}) {
  const [driverId, setDriverId] = useState(truck.driverId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveTruckAction({
        id: truck.id,
        expectedVersion: truck.version,
        input: { driverId },
      });
      if (result.ok) onDone(result.saved);
      else setError(result.message);
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <Select
        label="Driver"
        value={driverId}
        onChange={(e) => setDriverId(e.target.value)}
        hint={driverOptions.length === 0 ? "No drivers yet. Use + Add driver first." : undefined}
        error={error}
      >
        <option value="">No driver</option>
        {driverOptions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </Select>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={() => onDone()}>
          Close
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save driver"}
        </Button>
      </div>
    </form>
  );
}

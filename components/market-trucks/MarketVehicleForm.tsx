"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  addMarketVehicleAction,
  marketVehicleOptionsAction,
  updateMarketVehicleAction,
} from "@/app/(app)/market-trucks/vehicles/actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import type { MarketVehicleOptions } from "@/lib/data/market-vehicles";
import type { MarketVehicle } from "@/lib/types";
import { marketVehicleFields, type MarketVehicleInput } from "@/lib/validators/market-vehicle";
import { TruckDocInput } from "./TruckDocInput";

/**
 * Create (no `vehicle`) or edit a market vehicle. Owners and vehicle types load when it opens, so the form
 * can be dropped into any screen. `onSaved` gets the saved vehicle (quick-add from the challan screen).
 */
export function MarketVehicleForm({
  vehicle,
  initialVehicleNo,
  refreshOnSave = true,
  onSaved,
  onDone,
}: {
  vehicle?: MarketVehicle;
  initialVehicleNo?: string;
  /** Refresh the page's server data after saving (the list screen). Quick-add leaves the host screen alone. */
  refreshOnSave?: boolean;
  onSaved?: (vehicle: MarketVehicle) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<MarketVehicleOptions | null>(null);
  const [ownerId, setOwnerId] = useState(vehicle?.ownerPartyId ?? "");
  const [typeId, setTypeId] = useState(vehicle?.vehicleTypeId ?? "");
  const [capacity, setCapacity] = useState(vehicle?.capacityKg ? String(vehicle.capacityKg) : "");
  const [rcUrl, setRcUrl] = useState<string | null>(vehicle?.rcFileUrl ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();
  const version = useRef(vehicle?.version ?? 0);

  useEffect(() => {
    let live = true;
    void marketVehicleOptionsAction(vehicle?.ownerPartyId, vehicle?.vehicleTypeId).then((o) => {
      if (live) setOptions(o);
    });
    return () => {
      live = false;
    };
  }, [vehicle?.ownerPartyId, vehicle?.vehicleTypeId]);

  function pickType(id: string) {
    setTypeId(id);
    // Start the capacity from the type's, but never overwrite what the user typed.
    const typeCapacity = options?.types.find((t) => t.id === id)?.capacityKg;
    if (typeCapacity && !capacity) setCapacity(String(typeCapacity));
  }

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const get = (k: string) => String(data.get(k) ?? "");
    const input: MarketVehicleInput = {
      vehicleNo: get("vehicleNo"),
      ownerPartyId: ownerId,
      vehicleTypeId: typeId,
      capacityKg: capacity,
      rcOwnerName: get("rcOwnerName"),
      insuranceUpto: get("insuranceUpto"),
      fitnessUpto: get("fitnessUpto"),
      permitUpto: get("permitUpto"),
      pucUpto: get("pucUpto"),
      rcFileUrl: rcUrl,
    };
    const parsed = marketVehicleFields.safeParse(input);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = vehicle
        ? await updateMarketVehicleAction(vehicle.id, version.current, input)
        : await addMarketVehicleAction(input);
      if (result.ok) {
        version.current = result.vehicle.version;
        if (refreshOnSave) router.refresh();
        onSaved?.(result.vehicle);
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

  const loading = options === null;
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
        <Alert tone="warning" className="col-span-2" title="This vehicle was changed by someone else.">
          Close this and reopen it to see the latest details before saving again.
        </Alert>
      )}
      <Field
        label="Vehicle number"
        name="vehicleNo"
        required
        defaultValue={vehicle?.vehicleNo ?? initialVehicleNo ?? ""}
        error={errors.vehicleNo}
        hint="e.g. BR01GN8331 — spaces and dashes are ignored"
        autoCapitalize="characters"
        className="col-span-2 [&_input]:font-mono [&_input]:uppercase"
      />
      <Select
        label="Owner"
        name="ownerPartyId"
        value={ownerId}
        onChange={(e) => setOwnerId(e.target.value)}
        disabled={loading}
        error={errors.ownerPartyId}
        className="col-span-2"
      >
        <option value="">{loading ? "Loading…" : "— Not set —"}</option>
        {options?.owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.mobile ? ` · ${o.mobile}` : ""}
          </option>
        ))}
      </Select>
      <Select
        label="Vehicle type"
        name="vehicleTypeId"
        value={typeId}
        onChange={(e) => pickType(e.target.value)}
        disabled={loading}
        error={errors.vehicleTypeId}
        className="col-span-2 sm:col-span-1"
      >
        <option value="">{loading ? "Loading…" : "— Not set —"}</option>
        {options?.types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      <Field
        label="Capacity (kg)"
        name="capacityKg"
        inputMode="numeric"
        value={capacity}
        onChange={(e) => setCapacity(e.target.value)}
        error={errors.capacityKg}
        className="col-span-2 sm:col-span-1"
      />
      <Field label="RC owner name" name="rcOwnerName" defaultValue={vehicle?.rcOwnerName ?? ""} error={errors.rcOwnerName} hint="As printed on the RC" className="col-span-2" />
      <Field label="Insurance valid upto" name="insuranceUpto" type="date" defaultValue={vehicle?.insuranceUpto ?? ""} error={errors.insuranceUpto} className="col-span-2 sm:col-span-1" />
      <Field label="Fitness valid upto" name="fitnessUpto" type="date" defaultValue={vehicle?.fitnessUpto ?? ""} error={errors.fitnessUpto} className="col-span-2 sm:col-span-1" />
      <Field label="Permit valid upto" name="permitUpto" type="date" defaultValue={vehicle?.permitUpto ?? ""} error={errors.permitUpto} className="col-span-2 sm:col-span-1" />
      <Field label="PUC valid upto" name="pucUpto" type="date" defaultValue={vehicle?.pucUpto ?? ""} error={errors.pucUpto} className="col-span-2 sm:col-span-1" />
      <div className="col-span-2">
        <TruckDocInput label="RC copy" kind="rc" url={rcUrl} onChange={setRcUrl} error={errors.rcFileUrl} />
      </div>

      {formError && <p className="col-span-2 m-0 text-[13px] text-danger">{formError}</p>}
      <div className="col-span-2 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : vehicle ? "Save changes" : "Save vehicle"}
        </Button>
      </div>
    </form>
  );
}

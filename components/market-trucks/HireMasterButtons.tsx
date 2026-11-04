"use client";

// Add / Edit dialogs for the hire masters (vehicle types, charge types, pumps, branches, number
// series). One small shared form shell; each master only lists its fields.
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import {
  addBranchAction,
  addChargeTypeAction,
  addPumpAction,
  addSeriesAction,
  addVehicleTypeAction,
  updateBranchAction,
  updateChargeTypeAction,
  updatePumpAction,
  updateSeriesAction,
  updateVehicleTypeAction,
} from "@/app/(app)/market-trucks/masters/actions";
import type { ActionFailure } from "@/app/(app)/market-trucks/failure";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Field";
import type {
  Branch,
  ChargeType,
  HireNumberSeries,
  Pump,
  VehicleType,
} from "@/lib/types";

type Saved<T> = { ok: true; row: T } | ActionFailure;
type Errors = Record<string, string>;

const str = (d: FormData, k: string) => String(d.get(k) ?? "");
const int = (d: FormData, k: string) => {
  const s = str(d, k).trim();
  return s === "" ? null : Number(s);
};

function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex min-h-control items-center gap-2 text-sm text-text">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}

/** Dialog + trigger button. */
function MasterDialog({
  trigger,
  variant,
  title,
  description,
  children,
}: {
  trigger: string;
  variant?: "secondary";
  title: string;
  description: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description}>
        {children(() => setOpen(false))}
      </Dialog>
    </>
  );
}

/** Form shell: reads the fields, calls the action, shows field / conflict errors, refreshes the list. */
function MasterForm<I, R extends object>({
  noun,
  version = 0,
  read,
  save,
  onDone,
  submitLabel,
  children,
}: {
  noun: string;
  version?: number;
  read: (data: FormData) => I;
  save: (input: I, version: number) => Promise<Saved<R>>;
  onDone: () => void;
  submitLabel: string;
  children: (errors: Errors) => ReactNode;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();
  const current = useRef(version);

  function submit(form: HTMLFormElement) {
    const input = read(new FormData(form));
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await save(input, current.current);
      if (result.ok) {
        if ("version" in result.row) current.current = result.row.version as number;
        router.refresh();
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
        <Alert tone="warning" className="col-span-2" title={`This ${noun} was changed by someone else.`}>
          Close this and reopen it to see the latest details before saving again.
        </Alert>
      )}
      {children(errors)}
      {formError && <p className="col-span-2 m-0 text-[13px] text-danger">{formError}</p>}
      <div className="col-span-2 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

// ---------- vehicle types ----------

export function VehicleTypeButton({ row }: { row?: VehicleType }) {
  return (
    <MasterDialog
      trigger={row ? "Edit" : "+ Add vehicle type"}
      variant={row ? "secondary" : undefined}
      title={row ? row.name : "Add vehicle type"}
      description="Body type of a hired truck, e.g. 32ft MXL."
    >
      {(done) => (
        <MasterForm
          noun="vehicle type"
          version={row?.version}
          submitLabel={row ? "Save changes" : "Save vehicle type"}
          onDone={done}
          read={(d) => ({
            name: str(d, "name"),
            capacityKg: int(d, "capacityKg"),
            active: d.get("active") === "on",
          })}
          save={(input, v) => (row ? updateVehicleTypeAction(row.id, v, input) : addVehicleTypeAction(input))}
        >
          {(e) => (
            <>
              <Field label="Name" name="name" required defaultValue={row?.name ?? ""} error={e.name} className="col-span-2" />
              <Field label="Capacity (kg)" name="capacityKg" inputMode="numeric" defaultValue={row?.capacityKg ?? ""} error={e.capacityKg} className="col-span-2 sm:col-span-1" />
              <div className="col-span-2 sm:col-span-1 sm:pt-7">
                <Checkbox name="active" label="Active (shows in vehicle form)" defaultChecked={row?.active ?? true} />
              </div>
            </>
          )}
        </MasterForm>
      )}
    </MasterDialog>
  );
}

// ---------- charge types ----------

export function ChargeTypeButton({ row }: { row?: ChargeType }) {
  return (
    <MasterDialog
      trigger={row ? "Edit" : "+ Add charge type"}
      variant={row ? "secondary" : undefined}
      title={row ? row.label : "Add charge type"}
      description="A charge added to, or deducted from, the truck's hire."
    >
      {(done) => (
        <MasterForm
          noun="charge type"
          version={row?.version}
          submitLabel={row ? "Save changes" : "Save charge type"}
          onDone={done}
          read={(d) => ({
            code: str(d, "code"),
            label: str(d, "label"),
            defaultDirection: str(d, "defaultDirection") as "add" | "deduct",
            defaultBillParty: d.get("defaultBillParty") === "on",
            stage: str(d, "stage") as "hire" | "pod",
            active: d.get("active") === "on",
          })}
          save={(input, v) => (row ? updateChargeTypeAction(row.id, v, input) : addChargeTypeAction(input))}
        >
          {(e) => (
            <>
              <Field label="Code" name="code" required defaultValue={row?.code ?? ""} error={e.code} autoCapitalize="characters" className="col-span-2 sm:col-span-1 [&_input]:font-mono [&_input]:uppercase" />
              <Field label="Label" name="label" required defaultValue={row?.label ?? ""} error={e.label} className="col-span-2 sm:col-span-1" />
              <Select label="Default direction" name="defaultDirection" defaultValue={row?.defaultDirection ?? "deduct"} error={e.defaultDirection} className="col-span-2 sm:col-span-1">
                <option value="add">Add to truck hire</option>
                <option value="deduct">Deduct from truck hire</option>
              </Select>
              <Select label="Stage" name="stage" defaultValue={row?.stage ?? "pod"} error={e.stage} className="col-span-2 sm:col-span-1">
                <option value="hire">At hire (challan)</option>
                <option value="pod">At POD settlement</option>
              </Select>
              <div className="col-span-2 sm:col-span-1">
                <Checkbox name="defaultBillParty" label="Bill party by default" defaultChecked={row?.defaultBillParty ?? false} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Checkbox name="active" label="Active" defaultChecked={row?.active ?? false} />
              </div>
            </>
          )}
        </MasterForm>
      )}
    </MasterDialog>
  );
}

/** One-click first charge type when the master is empty (TIER1 §9 #3). */
export function AddLatePodFeeButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await addChargeTypeAction({
              code: "LATE_POD",
              label: "Late POD fee",
              defaultDirection: "deduct",
              defaultBillParty: false,
              stage: "pod",
              active: true,
            });
            if (result.ok) router.refresh();
            else setError(result.message);
          })
        }
      >
        {pending ? "Adding…" : "Add Late POD fee"}
      </Button>
      {error && <p className="m-0 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

// ---------- pumps ----------

export function PumpButton({ row }: { row?: Pump }) {
  return (
    <MasterDialog
      trigger={row ? "Edit" : "+ Add pump"}
      variant={row ? "secondary" : undefined}
      title={row ? row.name : "Add pump"}
      description="A diesel pump where truck advances are taken on slip."
    >
      {(done) => (
        <MasterForm
          noun="pump"
          version={row?.version}
          submitLabel={row ? "Save changes" : "Save pump"}
          onDone={done}
          read={(d) => ({ name: str(d, "name"), location: str(d, "location"), ledgerRef: str(d, "ledgerRef") })}
          save={(input, v) => (row ? updatePumpAction(row.id, v, input) : addPumpAction(input))}
        >
          {(e) => (
            <>
              <Field label="Name" name="name" required defaultValue={row?.name ?? ""} error={e.name} className="col-span-2" />
              <Field label="Location" name="location" defaultValue={row?.location ?? ""} error={e.location} className="col-span-2 sm:col-span-1" />
              <Field label="Ledger account" name="ledgerRef" defaultValue={row?.ledgerRef ?? ""} error={e.ledgerRef} hint="Account the diesel advances are debited to." className="col-span-2 sm:col-span-1" />
            </>
          )}
        </MasterForm>
      )}
    </MasterDialog>
  );
}

// ---------- branches ----------

export function BranchButton({ row }: { row?: Branch }) {
  return (
    <MasterDialog
      trigger={row ? "Edit" : "+ Add branch"}
      variant={row ? "secondary" : undefined}
      title={row ? row.name : "Add branch"}
      description="An office that issues challans and truck payments."
    >
      {(done) => (
        <MasterForm
          noun="branch"
          version={row?.version}
          submitLabel={row ? "Save changes" : "Save branch"}
          onDone={done}
          read={(d) => ({ name: str(d, "name"), code: str(d, "code"), address: str(d, "address") })}
          save={(input, v) => (row ? updateBranchAction(row.id, v, input) : addBranchAction(input))}
        >
          {(e) => (
            <>
              <Field label="Name" name="name" required defaultValue={row?.name ?? ""} error={e.name} className="col-span-2 sm:col-span-1" />
              <Field label="Code" name="code" defaultValue={row?.code ?? ""} error={e.code} className="col-span-2 sm:col-span-1" />
              <Field label="Address" name="address" defaultValue={row?.address ?? ""} error={e.address} className="col-span-2" />
            </>
          )}
        </MasterForm>
      )}
    </MasterDialog>
  );
}

// ---------- number series ----------

const KIND_LABEL = { challan: "Challan", truck_payment: "Truck payment" } as const;
export const seriesKindLabel = (k: keyof typeof KIND_LABEL) => KIND_LABEL[k];

const counterRead = (d: FormData) => ({
  prefix: str(d, "prefix"),
  nextNo: int(d, "nextNo") ?? Number.NaN,
  padding: int(d, "padding") ?? Number.NaN,
});

function CounterFields({ row, e }: { row?: HireNumberSeries; e: Errors }) {
  return (
    <>
      <Field label="Prefix" name="prefix" defaultValue={row?.prefix ?? ""} error={e.prefix} hint="e.g. CH/26-27/" className="col-span-2 sm:col-span-1 [&_input]:font-mono" />
      <Field label="Next number" name="nextNo" inputMode="numeric" required defaultValue={row?.nextNo ?? 1} error={e.nextNo} className="col-span-2 sm:col-span-1" />
      <Field label="Padding (digits)" name="padding" inputMode="numeric" required defaultValue={row?.padding ?? 4} error={e.padding} hint="4 turns 7 into 0007; 0 = no padding." className="col-span-2 sm:col-span-1" />
    </>
  );
}

export function SeriesButton({
  row,
  branches,
}: {
  row?: HireNumberSeries;
  branches?: { id: string; name: string }[];
}) {
  return (
    <MasterDialog
      trigger={row ? "Edit" : "+ Add number series"}
      variant={row ? "secondary" : undefined}
      title={row ? `${KIND_LABEL[row.docType]} · ${row.branchName} · ${row.fy}` : "Add number series"}
      description={
        row
          ? "The next number can only go up, so no number is issued twice."
          : "One counter per document type, branch and financial year."
      }
    >
      {(done) => (
        <MasterForm
          noun="number series"
          submitLabel={row ? "Save changes" : "Save series"}
          onDone={done}
          read={(d) => ({
            docType: str(d, "docType") as "challan" | "truck_payment",
            branchId: str(d, "branchId"),
            fy: str(d, "fy"),
            ...counterRead(d),
          })}
          save={(input) =>
            row
              ? updateSeriesAction(
                  { docType: row.docType, branchId: row.branchId, fy: row.fy },
                  { prefix: input.prefix, nextNo: input.nextNo, padding: input.padding },
                )
              : addSeriesAction(input)
          }
        >
          {(e) => (
            <>
              {!row && (
                <>
                  <Select label="Document" name="docType" defaultValue="challan" error={e.docType} className="col-span-2 sm:col-span-1">
                    <option value="challan">Challan</option>
                    <option value="truck_payment">Truck payment</option>
                  </Select>
                  <Select label="Branch" name="branchId" required defaultValue="" error={e.branchId} className="col-span-2 sm:col-span-1">
                    <option value="" disabled>
                      Choose a branch
                    </option>
                    {branches?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                  <Field label="Financial year" name="fy" required placeholder="2026-27" error={e.fy} className="col-span-2 sm:col-span-1 [&_input]:font-mono" />
                </>
              )}
              <CounterFields row={row} e={e} />
            </>
          )}
        </MasterForm>
      )}
    </MasterDialog>
  );
}

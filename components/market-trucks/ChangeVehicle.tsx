"use client";

// "Change vehicle" on a dispatched challan: new vehicle, optional new driver, reason. Creates the
// Update Part-B tasks (one per LR with an e-way no.). Native <dialog>, no extra library.
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  changeChallanVehicleAction,
  searchChallanDriversAction,
  searchChallanVehiclesAction,
} from "@/app/(app)/market-trucks/challans/actions";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import type { MarketVehicleRow } from "@/lib/data/market-vehicles";
import type { MarketDriver } from "@/lib/types";

export function ChangeVehicle({
  challanId,
  version,
  currentVehicleNo,
}: {
  challanId: string;
  version: number;
  currentVehicleNo: string | null;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [vSearch, setVSearch] = useState("");
  const [vehicles, setVehicles] = useState<MarketVehicleRow[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [dSearch, setDSearch] = useState("");
  const [drivers, setDrivers] = useState<MarketDriver[]>([]);
  const [driverId, setDriverId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ tasks: number; warnings: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const open = () => {
    setError(null);
    setResult(null);
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();

  function searchVehicles(q: string) {
    setVSearch(q);
    if (q.trim().length < 2) return setVehicles([]);
    startTransition(async () => setVehicles(await searchChallanVehiclesAction(q)));
  }
  function searchDrivers(q: string) {
    setDSearch(q);
    if (q.trim().length < 2) return setDrivers([]);
    startTransition(async () => setDrivers(await searchChallanDriversAction(q)));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await changeChallanVehicleAction(challanId, version, {
        newVehicleId: vehicleId,
        newDriverId: driverId || null,
        reason,
      });
      if (!r.ok) return setError(r.message);
      setResult({ tasks: r.tasks, warnings: r.warnings });
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={open}>
        Change vehicle
      </Button>
      <dialog
        ref={ref}
        aria-label="Change vehicle"
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-5 text-text backdrop:bg-black/40"
      >
        <h2 className="m-0 mb-1 text-base font-semibold">Change vehicle</h2>
        <p className="m-0 mb-4 text-[13px] text-muted">
          Now: <span className="font-mono">{currentVehicleNo ?? "—"}</span>. The payee stays the same.
        </p>
        {result ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="m-0">
              Vehicle changed.{" "}
              {result.tasks > 0
                ? `${result.tasks} “Update Part-B” ${result.tasks === 1 ? "task" : "tasks"} created.`
                : "No LR on this challan has an e-way bill, so no Part-B task was needed."}
            </p>
            {result.warnings.map((w) => (
              <p key={w} className="m-0 rounded-input bg-warning-soft p-2 text-warning">
                {w}
              </p>
            ))}
            <div className="flex justify-end">
              <Button onClick={close}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Search new vehicle (no.)" value={vSearch} onChange={(e) => searchVehicles(e.target.value)} />
            <Select label="New vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Select…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vehicleNo}
                </option>
              ))}
            </Select>
            <Field label="Search new driver (optional)" value={dSearch} onChange={(e) => searchDrivers(e.target.value)} />
            <Select label="New driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Keep the current driver</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            {error && (
              <p role="alert" className="m-0 text-[13px] text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={save} disabled={pending || !vehicleId || reason.trim().length < 3}>
                {pending ? "Saving…" : "Change vehicle"}
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

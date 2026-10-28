"use client";

import { useState } from "react";
import { searchTrucksAction } from "@/app/(app)/lr/form-actions";
import { Combobox } from "@/components/ui/Combobox";
import type { TruckOption } from "@/lib/lr-form";
import { NewTruckDialog } from "./NewTruckDialog";

/** Truck no. picker: search by number ("br01" finds BR01GN8331) or add a new truck inline. */
export function TruckPicker({
  id,
  label = "Truck no.",
  truck,
  onChange,
  error,
}: {
  id: string;
  label?: string;
  truck: TruckOption | null;
  onChange: (truck: TruckOption | null) => void;
  error?: string;
}) {
  const [adding, setAdding] = useState<string | null>(null);

  return (
    <div className="min-w-0">
      <Combobox<TruckOption>
        id={id}
        label={label}
        listLabel="Saved trucks"
        placeholder="Search truck number"
        selectedText={truck?.number ?? ""}
        loadOptions={searchTrucksAction}
        getKey={(t) => t.id}
        renderOption={(t) => (
          <>
            <b className="font-mono">{t.number}</b>
            <br />
            <span className="text-muted">
              {[
                t.driverMobile ? `Driver ${t.driverMobile}` : "No driver saved",
                t.lastLrNo ? `last LR ${t.lastLrNo}` : "new",
              ].join(" · ")}
            </span>
          </>
        )}
        onPick={onChange}
        onClear={() => onChange(null)}
        addNew={{ label: "+ Add new truck", onSelect: (q) => setAdding(q) }}
        inputClassName="font-mono uppercase placeholder:font-sans placeholder:normal-case"
        error={error}
      />
      <NewTruckDialog
        open={adding !== null}
        initialText={adding ?? ""}
        onClose={() => setAdding(null)}
        onCreated={(t) => {
          setAdding(null);
          onChange(t);
        }}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { searchPartiesAction } from "@/app/(app)/lr/form-actions";
import { Combobox, type ComboboxPinned } from "@/components/ui/Combobox";
import { cx } from "@/lib/cx";
import type { PartyOption } from "@/lib/lr-form";
import { NewPartyDialog } from "./NewPartyDialog";

const partyName = (p: PartyOption) => (p.place ? `${p.name} – ${p.place}` : p.name);

/** What's saved for the picked party, under the field (green; amber for one just added). */
function PartyDetails({ party, isNew }: { party: PartyOption; isNew: boolean }) {
  const first = [
    isNew ? "New party · added to Parties" : "Saved party",
    party.gstin ? `GST ${party.gstin}` : "no GSTIN",
    party.phone,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={cx("text-[13px] leading-normal", isNew ? "text-warning" : "text-success")}>
      {first}
      {party.address && (
        <>
          <br />
          {party.address}
        </>
      )}
    </div>
  );
}

/**
 * Consignor / consignee / billed-to picker: search by name, place, GSTIN or phone,
 * or add a new party inline.
 */
export function PartyPicker({
  id,
  label,
  role,
  party,
  isNew = false,
  onChange,
  error,
  pinned,
  selectedTextOverride,
}: {
  id: string;
  label: string;
  /** For the "New …" dialog title. */
  role: string;
  party: PartyOption | null;
  isNew?: boolean;
  onChange: (party: PartyOption | null, created?: boolean) => void;
  error?: string;
  pinned?: ComboboxPinned[];
  /** Shown instead of the party name, e.g. "Same as consignee". */
  selectedTextOverride?: string;
}) {
  const [adding, setAdding] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Combobox<PartyOption>
        id={id}
        label={label}
        listLabel={`Saved parties for ${role}`}
        placeholder="Search name or GSTIN"
        selectedText={selectedTextOverride ?? (party ? partyName(party) : "")}
        loadOptions={searchPartiesAction}
        getKey={(p) => p.id}
        renderOption={(p) => (
          <>
            <b>{partyName(p)}</b>
            <br />
            <span className="text-muted">
              {p.gstin ? <span className="font-mono">{p.gstin}</span> : "No GSTIN"}
              {p.phone && ` · ${p.phone}`}
            </span>
          </>
        )}
        onPick={(p) => onChange(p)}
        onClear={() => onChange(null)}
        pinned={pinned}
        addNew={{ label: "+ Add new party", onSelect: (q) => setAdding(q) }}
        error={error}
      />
      {party && !selectedTextOverride && <PartyDetails party={party} isNew={isNew} />}
      <NewPartyDialog
        open={adding !== null}
        role={role}
        initialText={adding ?? ""}
        onClose={() => setAdding(null)}
        onCreated={(p) => {
          setAdding(null);
          onChange(p, true);
        }}
      />
    </div>
  );
}

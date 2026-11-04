"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { TruckParty } from "@/lib/types";
import { TdsDeclarations } from "./TdsDeclarations";
import { TruckPartyForm } from "./TruckPartyForm";

/** Row action: edit a truck party and its TDS declarations in a dialog. */
export function EditTruckPartyButton({ party }: { party: TruckParty }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={party.name}
        description="Bank, UPI and verification. Changing bank or UPI details is logged."
      >
        <TruckPartyForm party={party} onDone={() => setOpen(false)} />
        <TdsDeclarations partyId={party.id} />
      </Dialog>
    </>
  );
}

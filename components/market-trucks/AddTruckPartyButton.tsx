"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TruckPartyForm } from "./TruckPartyForm";

/** "+ Add truck party": the full form in a dialog. */
export function AddTruckPartyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add truck party</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add truck party"
        description="An owner or broker you pay lorry hire to."
      >
        <TruckPartyForm onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

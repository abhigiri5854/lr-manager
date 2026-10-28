"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { PartyForm } from "./PartyForm";

/** "+ Add party": the full party form in a dialog; opens the new party after saving. */
export function AddPartyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add party</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add party"
        description="Saved to Parties, so it can be picked on any LR or invoice."
      >
        <PartyForm mode="create" onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

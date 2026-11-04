"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { MarketVehicleForm } from "./MarketVehicleForm";

/** "+ Add vehicle": the full form in a dialog. */
export function AddMarketVehicleButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add vehicle</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add vehicle"
        description="A hired truck: owner, RC and document expiry dates."
      >
        <MarketVehicleForm onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

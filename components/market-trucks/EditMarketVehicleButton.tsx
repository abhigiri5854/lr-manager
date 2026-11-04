"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { MarketVehicle } from "@/lib/types";
import { MarketVehicleForm } from "./MarketVehicleForm";

/** Row action: edit a market vehicle in a dialog. */
export function EditMarketVehicleButton({ vehicle }: { vehicle: MarketVehicle }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={vehicle.vehicleNo}
        description="Owner, RC and document expiry dates."
      >
        <MarketVehicleForm vehicle={vehicle} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

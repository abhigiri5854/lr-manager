"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { DriverForm } from "./DriverForm";
import { TruckForm, type DriverOption } from "./TruckForm";

/** "+ Add driver" and "+ Add truck", each opening its form in a dialog. */
export function AddButtons({ driverOptions }: { driverOptions: DriverOption[] }) {
  const [open, setOpen] = useState<"driver" | "truck" | null>(null);
  const close = () => setOpen(null);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen("driver")}>
        + Add driver
      </Button>
      <Button onClick={() => setOpen("truck")}>+ Add truck</Button>
      <Dialog
        open={open === "driver"}
        onClose={close}
        title="Add driver"
        description="Mobile number is the driver's ID; each one can be saved once."
      >
        <DriverForm onDone={close} />
      </Dialog>
      <Dialog
        open={open === "truck"}
        onClose={close}
        title="Add truck"
        description="Saved to Trucks & drivers, so it can be picked on any LR."
      >
        <TruckForm driverOptions={driverOptions} onDone={close} />
      </Dialog>
    </>
  );
}

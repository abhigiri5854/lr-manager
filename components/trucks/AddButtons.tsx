"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { DriverForm } from "./DriverForm";
import { TruckForm, type DriverOption } from "./TruckForm";

/** "+ Add driver" and "+ Add truck", each opening its form in a dialog. */
export function AddButtons({ driverOptions }: { driverOptions: DriverOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<"driver" | "truck" | null>(null);
  const close = () => setOpen(null);
  /** Saved: close at once; the new row appears when the lists refresh in the background. */
  const done = (saved?: unknown) => {
    close();
    if (saved) router.refresh();
  };
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
        <DriverForm onDone={done} />
      </Dialog>
      <Dialog
        open={open === "truck"}
        onClose={close}
        title="Add truck"
        description="Saved to Trucks & drivers, so it can be picked on any LR."
      >
        <TruckForm driverOptions={driverOptions} onDone={done} />
      </Dialog>
    </>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { MarketDriverForm } from "./MarketDriverForm";

/** "+ Add driver": the full form in a dialog. */
export function AddMarketDriverButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add driver</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add driver"
        description="A driver on a hired truck: mobile and licence."
      >
        <MarketDriverForm onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

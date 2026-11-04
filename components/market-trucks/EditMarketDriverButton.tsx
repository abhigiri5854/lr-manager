"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { MarketDriver } from "@/lib/types";
import { MarketDriverForm } from "./MarketDriverForm";

/** Row action: edit a market driver in a dialog. */
export function EditMarketDriverButton({ driver }: { driver: MarketDriver }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={driver.name}
        description="Mobile and licence details."
      >
        <MarketDriverForm driver={driver} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

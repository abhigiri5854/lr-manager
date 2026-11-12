"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { MarketDriver } from "@/lib/types";
import { DriverLinkPanel } from "./DriverLinkPanel";
import { MarketDriverForm } from "./MarketDriverForm";

/** Row action: edit a market driver in a dialog. */
export function EditMarketDriverButton({
  driver,
  canEdit = false,
}: {
  driver: MarketDriver;
  /** master.edit — shows the app-link buttons. */
  canEdit?: boolean;
}) {
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
        <div className="mt-4 border-t border-border pt-4">
          <DriverLinkPanel driverId={driver.id} driverName={driver.name} mobile={driver.mobile} canEdit={canEdit} />
        </div>
      </Dialog>
    </>
  );
}

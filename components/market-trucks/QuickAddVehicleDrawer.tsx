"use client";

import { Drawer } from "@/components/ui/Drawer";
import type { MarketVehicle } from "@/lib/types";
import { MarketVehicleForm } from "./MarketVehicleForm";

/**
 * Add a vehicle without leaving the current screen (e.g. the challan form when the typed number is
 * unknown). The host controls `open` and receives the saved vehicle in `onCreated`.
 */
export function QuickAddVehicleDrawer({
  open,
  onClose,
  onCreated,
  initialVehicleNo,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (vehicle: MarketVehicle) => void;
  /** Pre-fills the number the user already typed. */
  initialVehicleNo?: string;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add vehicle"
      description="Saved to Market vehicles; you can complete the RC details later."
    >
      <MarketVehicleForm
        initialVehicleNo={initialVehicleNo}
        refreshOnSave={false}
        onSaved={onCreated}
        onDone={onClose}
      />
    </Drawer>
  );
}

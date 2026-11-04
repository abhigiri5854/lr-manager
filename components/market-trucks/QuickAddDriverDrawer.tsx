"use client";

import { Drawer } from "@/components/ui/Drawer";
import type { MarketDriver } from "@/lib/types";
import { MarketDriverForm } from "./MarketDriverForm";

/**
 * Add a driver without leaving the current screen (e.g. the challan form). The host controls `open`
 * and receives the saved driver in `onCreated`.
 */
export function QuickAddDriverDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (driver: MarketDriver) => void;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add driver"
      description="Saved to Market drivers; you can complete the licence details later."
    >
      <MarketDriverForm refreshOnSave={false} onSaved={onCreated} onDone={onClose} />
    </Drawer>
  );
}

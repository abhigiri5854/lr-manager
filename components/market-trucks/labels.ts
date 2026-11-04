import type { TruckPartyRole } from "@/lib/types";

export const truckPartyRoleLabel: Record<TruckPartyRole, string> = {
  owner: "Owner",
  broker: "Broker",
  both: "Owner & broker",
};

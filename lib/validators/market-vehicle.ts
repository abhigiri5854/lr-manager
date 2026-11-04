import { z } from "zod";
import { isoDate, optional, optionalText, uuid, vehicleNoSchema } from "./common";

// Market (hired) vehicles: TIER1-MARKET-TRUCKS.md §5 `market_vehicles`.
export const marketVehicleFields = z.object({
  vehicleNo: vehicleNoSchema,
  ownerPartyId: optional(uuid),
  vehicleTypeId: optional(uuid),
  capacityKg: optional(z.coerce.number().int("Whole kg").positive("Must be more than 0").max(200_000)),
  rcOwnerName: optionalText(200),
  insuranceUpto: optional(isoDate),
  fitnessUpto: optional(isoDate),
  permitUpto: optional(isoDate),
  pucUpto: optional(isoDate),
  rcFileUrl: optionalText(500),
});
export const marketVehiclePatchSchema = marketVehicleFields.partial();
export type MarketVehicleInput = z.input<typeof marketVehicleFields>;
export type MarketVehicleValues = z.output<typeof marketVehicleFields>;
export type MarketVehiclePatch = z.input<typeof marketVehiclePatchSchema>;

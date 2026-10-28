import { z } from "zod";
import {
  isoDate,
  mobileSchema,
  optional,
  optionalText,
  recordSourceSchema,
  uuid,
  vehicleNoSchema,
} from "./common";

export const truckFields = z.object({
  number: vehicleNoSchema,
  driverId: optional(uuid),
  rcExpiry: optional(isoDate),
  insuranceExpiry: optional(isoDate),
  permitExpiry: optional(isoDate),
  fitnessExpiry: optional(isoDate),
  source: recordSourceSchema.optional(),
});
export const truckPatchSchema = truckFields.partial();
export type TruckInput = z.input<typeof truckFields>;
export type TruckPatch = z.input<typeof truckPatchSchema>;

export const driverFields = z.object({
  mobile: mobileSchema,
  name: optionalText(100),
  licenceNo: optionalText(30),
  licenceExpiry: optional(isoDate),
  userId: optional(uuid),
});
export const driverPatchSchema = driverFields.partial();
export type DriverInput = z.input<typeof driverFields>;
export type DriverPatch = z.input<typeof driverPatchSchema>;

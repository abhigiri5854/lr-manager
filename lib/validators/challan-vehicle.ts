import { z } from "zod";

/** Change vehicle (and optionally driver) on a dispatched challan. */
export const challanVehicleChangeFields = z.object({
  newVehicleId: z.uuid("Pick the new vehicle"),
  newDriverId: z.uuid().nullish(),
  reason: z.string().trim().min(3, "Enter a reason").max(300, "At most 300 characters"),
});
export type ChallanVehicleChangeInput = z.input<typeof challanVehicleChangeFields>;
export type ChallanVehicleChangeValues = z.output<typeof challanVehicleChangeFields>;

/** Statuses where the vehicle may still change: on the road or waiting for POD, never draft / settled. */
export const VEHICLE_CHANGE_STATUSES = ["dispatched", "in_transit", "reached", "pod_received"] as const;

import { z } from "zod";

// Driver links: trip events (from the driver's phone or office staff) and the driver's POD details.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID, "Not a valid id");

export const TRIP_EVENT_TYPES = ["loaded", "en_route", "reached"] as const;
export const tripEventType = z.enum(TRIP_EVENT_TYPES);

const latitude = z.number().min(-90, "Location not available").max(90, "Location not available");
const longitude = z.number().min(-180, "Location not available").max(180, "Location not available");
const accuracy = z.number().min(0).max(1_000_000);

/**
 * From the driver's link: the phone's GPS reading is optional. With no location (or only half of one) the
 * event is still saved, location empty; accuracy is dropped when there is no location.
 */
export const driverEventFields = z
  .object({
    challanId: uuid,
    type: tripEventType,
    lat: latitude.nullish(),
    lng: longitude.nullish(),
    accuracyM: accuracy.nullish(),
  })
  .transform((v) => {
    const located = v.lat != null && v.lng != null;
    return {
      challanId: v.challanId,
      type: v.type,
      lat: located ? v.lat! : null,
      lng: located ? v.lng! : null,
      accuracyM: located ? (v.accuracyM ?? null) : null,
    };
  });
export type DriverEventInput = z.input<typeof driverEventFields>;

/** The phone's background "last seen" ping: a location is required (a ping without one is meaningless). */
export const driverPingFields = z.object({
  lat: latitude,
  lng: longitude,
  accuracyM: accuracy.nullish(),
});
export type DriverPingInput = z.input<typeof driverPingFields>;

/** Office staff marking a milestone (no location). */
export const staffTripEventFields = z.object({
  type: tripEventType,
  note: z
    .string()
    .trim()
    .max(500, "Keep the note under 500 characters")
    .nullable()
    .optional()
    .transform((v) => v || null),
});
export type StaffTripEventInput = z.input<typeof staffTripEventFields>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Not a valid date")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Not a valid date");

/** History paging: only challans dated before this day (yyyy-mm-dd). */
export const driverHistoryFields = z.object({ before: isoDate.nullish() });

/** The driver's POD for one LR: delivery date (default: already recorded, else today) and packages delivered from this truck. */
export const driverPodFields = z.object({
  challanId: uuid,
  lrId: uuid,
  deliveredOn: isoDate.optional(),
  packages: z.number().int("Whole packages only").min(0).max(1_000_000).nullable().optional(),
});
export type DriverPodInput = z.input<typeof driverPodFields>;

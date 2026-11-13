// Driver links: a market driver's personal WhatsApp link (no login). Database only, like challans:
// under unit tests the owner-side writes stop after their permission check.
//
// Owner side (signed in): master.edit, each write audited.
//   getOrCreateDriverLink → full URL <APP_BASE_URL>/d/<token> (same URL on every resend)
//   revokeDriverLink, listTripEvents, addStaffTripEvent
// Token side (SESSION-LESS — no assertCan, no cookie): the token is the credential. Each call checks
// the token's shape, rate-limits it (60 / min per link, per server instance), and sends only its
// SHA-256 to app.driver_* functions, which refuse a missing / revoked / expired link or another
// driver's challan and never return hire, freight, margin or balance.
//   openDriverLink, driverTrips, recordDriverEvent, uploadDriverPod
import {
  createRateLimiter,
  DriverLinkError,
  driverLinkKey,
  driverPodFileProblem,
  hashToken,
  isTokenShape,
  sniffPodType,
  TooManyRequestsError,
} from "@/lib/driver-link";
import type {
  DriverHistory,
  DriverLinkInfo,
  DriverLinkStatus,
  DriverLinkView,
  DriverPodResult,
  DriverTrip,
  TripEvent,
  TripEventType,
} from "@/lib/types";
import {
  driverEventFields,
  driverHistoryFields,
  driverPingFields,
  driverPodFields,
  staffTripEventFields,
  type DriverEventInput,
  type DriverPodInput,
} from "@/lib/validators/driver-link";
import { fail, newId, parseInput } from "./_store";
import * as dbs from "./db/driver-links";
import { deleteObject, podObjectPath, putObject, safeName } from "./db/storage";
import { assertCan } from "./session";
import { onDatabase } from "./source";

export { DriverLinkError, TooManyRequestsError };

const DB_ONLY = "Driver links need the database";

/** Where links point. Required (never taken from the request's Host header). */
export function appBaseUrl(): string {
  const base = process.env.APP_BASE_URL?.trim();
  if (!base || !/^https?:\/\/[^/\s]+/.test(base)) {
    throw new Error("APP_BASE_URL must be set (.env.local), e.g. https://lr.example.com, to build driver links");
  }
  return base.replace(/\/+$/, "");
}

// ---------- owner side ----------
/** The driver's link to send on WhatsApp: the same URL every time, or a new one if none / expired. */
export async function getOrCreateDriverLink(companyId: string, driverId: string): Promise<DriverLinkView> {
  await assertCan(companyId, "master.edit");
  if (!onDatabase()) fail("", DB_ONLY);
  driverLinkKey(); // fail closed before touching the database
  return dbs.getOrCreateDriverLink(companyId, driverId, appBaseUrl());
}

/** Stops the driver's link at once. A new one can be made afterwards (different URL). */
export async function revokeDriverLink(companyId: string, driverId: string): Promise<{ revoked: boolean }> {
  await assertCan(companyId, "master.edit");
  if (!onDatabase()) fail("", DB_ONLY);
  return dbs.revokeDriverLink(companyId, driverId);
}

/** Loaded / en route / reached on a challan, from staff and the driver's link. */
export async function listTripEvents(companyId: string, challanId: string): Promise<TripEvent[]> {
  await assertCan(companyId, "freight.view");
  return onDatabase() ? dbs.listTripEvents(companyId, challanId) : [];
}

/** Office staff mark a milestone (no location); repeating a type updates its time and note. */
export async function addStaffTripEvent(
  companyId: string,
  challanId: string,
  type: TripEventType,
  note?: string | null,
): Promise<TripEvent> {
  await assertCan(companyId, "master.edit");
  const v = parseInput(staffTripEventFields, { type, note });
  if (!onDatabase()) fail("", DB_ONLY);
  return dbs.addStaffTripEvent(companyId, challanId, v.type, v.note);
}

// ---------- token side (session-less) ----------
const limiter = createRateLimiter(60, 60_000);

/** The token's hash after the shape and rate-limit checks; null = not a link we could have made. */
function linkHash(token: string): string | null {
  if (!isTokenShape(token)) return null;
  const hash = hashToken(token);
  if (!limiter.take(hash)) throw new TooManyRequestsError();
  return hash;
}

/** Session-less. Who the link is for; null when the link is missing, revoked or expired. */
export async function openDriverLink(token: string): Promise<DriverLinkInfo | null> {
  const hash = linkHash(token);
  if (!hash || !onDatabase()) return null;
  return dbs.openDriverLinkByHash(hash);
}

/** Session-less. The driver + their trips (live, and settled in the last 3 days read-only); null = bad link. */
export async function driverTrips(
  token: string,
): Promise<{ driver: DriverLinkInfo; trips: DriverTrip[] } | null> {
  const hash = linkHash(token);
  if (!hash || !onDatabase()) return null;
  return dbs.driverTripsByHash(hash);
}

/** Session-less. Loaded / en route / reached with the phone's location, on the driver's own live challan. */
export async function recordDriverEvent(token: string, input: DriverEventInput): Promise<TripEvent> {
  const v = parseInput(driverEventFields, input);
  const hash = linkHash(token);
  if (!hash) throw new DriverLinkError();
  if (!onDatabase()) fail("", DB_ONLY);
  return dbs.recordDriverEventByHash(hash, v);
}

/**
 * Session-less. A POD photo / PDF (JPEG, PNG, WebP or PDF, ≤ 10 MB) for one LR of the driver's own
 * non-settled challan: stored in the private `pod` bucket under the company's folder (server secret
 * key), then attached to the LR's POD; the challan follows (dates, status, delivered packages).
 * deliveredOn defaults to the date already recorded, else today; packages = delivered from this truck.
 */
export async function uploadDriverPod(
  token: string,
  challanId: string,
  lrId: string,
  file: { name: string; type: string; bytes: Uint8Array },
  details: Omit<DriverPodInput, "challanId" | "lrId"> = {},
): Promise<DriverPodResult> {
  const v = parseInput(driverPodFields, { ...details, challanId, lrId });
  const problem = driverPodFileProblem(file);
  if (problem) fail("file", problem);
  const hash = linkHash(token);
  if (!hash) throw new DriverLinkError();
  if (!onDatabase()) fail("", DB_ONLY);

  // Refuse before storing anything that isn't the driver's own live trip.
  const companyId = await dbs.driverPodTargetByHash(hash, v.challanId, v.lrId);
  if (!companyId) throw new DriverLinkError("This trip isn't on your link any more. Call the office.");
  const path = podObjectPath(companyId, v.lrId, newId(), safeName(file.name, "pod"));
  await putObject("pod", path, { type: sniffPodType(file.bytes)!, bytes: file.bytes });
  try {
    return await dbs.attachDriverPodByHash(hash, v, [path]);
  } catch (e) {
    // The database refused (settled, too many packages, link revoked meanwhile…): don't leave an orphan file.
    await deleteObject("pod", path).catch((err: unknown) =>
      console.error(`driver POD: could not delete orphan file ${path}`, err),
    );
    throw e;
  }
}

/**
 * Session-less. Last-seen ping from the phone (location + accuracy). True = saved; false = ignored (the
 * link is revoked / expired, or the last ping was under 5 minutes ago). A malformed token is refused.
 */
export async function recordDriverPing(
  token: string,
  lat: number,
  lng: number,
  accuracyM?: number | null,
): Promise<boolean> {
  const v = parseInput(driverPingFields, { lat, lng, accuracyM });
  const hash = linkHash(token);
  if (!hash) throw new DriverLinkError();
  if (!onDatabase()) fail("", DB_ONLY);
  return dbs.pingDriverByHash(hash, v);
}

/** Session-less. The driver's settled / cancelled trips (newest first, 20 a page) + this month's summary; null = bad link. */
export async function driverHistory(token: string, before?: string | null): Promise<DriverHistory | null> {
  const v = parseInput(driverHistoryFields, { before });
  const hash = linkHash(token);
  if (!hash || !onDatabase()) return null;
  return dbs.driverHistoryByHash(hash, v.before ?? null);
}

// ---------- owner side: link status ----------
/** Is the driver's link live, when it was last opened, and where the phone was last seen (freight.view). */
export async function getDriverLinkStatus(companyId: string, driverId: string): Promise<DriverLinkStatus | null> {
  await assertCan(companyId, "freight.view");
  return onDatabase() ? dbs.getDriverLinkStatus(companyId, driverId) : null;
}

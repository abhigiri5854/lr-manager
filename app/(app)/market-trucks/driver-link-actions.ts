"use server";

// Owner-side driver-app actions: send / revoke a driver's link, link status, staff trip events.
// Role checks (master.edit / freight.view) happen in lib/data/driver-links.
import { revalidatePath } from "next/cache";
import {
  addStaffTripEvent,
  getDriverLinkStatus,
  getOrCreateDriverLink,
  revokeDriverLink,
} from "@/lib/data/driver-links";
import { getActiveCompanyId } from "@/lib/data/session";
import type { DriverLinkStatus, TripEvent, TripEventType } from "@/lib/types";
import { toFailure, type ActionFailure } from "./failure";

/** Expected errors keep their message; anything else (e.g. missing secret / base URL) becomes a friendly one. */
function linkFailure(e: unknown): ActionFailure {
  try {
    return toFailure(e);
  } catch {
    console.error("driver-link action failed", e);
    const msg = e instanceof Error ? e.message : "";
    const setup = /APP_BASE_URL|secret|DRIVER_LINK/i.test(msg);
    return {
      ok: false,
      kind: "error",
      message: setup
        ? "Driver link is not set up – contact admin"
        : "Something went wrong. Please try again.",
    };
  }
}

/** The driver's link URL (same URL on every call until revoked / expired). */
export async function getDriverLinkAction(
  driverId: string,
): Promise<{ ok: true; url: string } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const link = await getOrCreateDriverLink(companyId, driverId);
    revalidatePath("/market-trucks/drivers");
    revalidatePath("/market-trucks/challans/[id]", "page");
    return { ok: true, url: link.url };
  } catch (e) {
    return linkFailure(e);
  }
}

export async function revokeDriverLinkAction(
  driverId: string,
): Promise<{ ok: true; revoked: boolean } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const r = await revokeDriverLink(companyId, driverId);
    revalidatePath("/market-trucks/drivers");
    revalidatePath("/market-trucks/challans/[id]", "page");
    return { ok: true, revoked: r.revoked };
  } catch (e) {
    return linkFailure(e);
  }
}

/** Link status for the drawer / trip section; null status = no link was ever sent. */
export async function driverLinkStatusAction(
  driverId: string,
): Promise<{ ok: true; status: DriverLinkStatus | null } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    return { ok: true, status: await getDriverLinkStatus(companyId, driverId) };
  } catch (e) {
    return linkFailure(e);
  }
}

/** Office staff mark Loaded / On the way / Reached for a driver without a smartphone. */
export async function addStaffTripEventAction(
  challanId: string,
  type: TripEventType,
  note?: string | null,
): Promise<{ ok: true; event: TripEvent } | ActionFailure> {
  const companyId = await getActiveCompanyId();
  try {
    const event = await addStaffTripEvent(companyId, challanId, type, note);
    revalidatePath("/market-trucks/challans/[id]", "page");
    revalidatePath("/market-trucks/challans");
    return { ok: true, event };
  } catch (e) {
    return linkFailure(e);
  }
}

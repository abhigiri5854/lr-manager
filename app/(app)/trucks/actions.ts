"use server";

// Server actions for Trucks & drivers. Role checks happen in lib/data (lib/permissions.ts).
// Saves hand back the saved row and don't re-render the page (CLAUDE.md "Database performance");
// the list shows the row at once and refreshes itself in the background.
import { refresh } from "next/cache";
import { toActionFailure, type ActionFailure } from "@/lib/data/errors";
import { getActiveCompanyId } from "@/lib/data/session";
import {
  cancelDriver,
  cancelTruck,
  createDriver,
  createTruck,
  findTruckByNumber,
  inviteDriver,
  updateDriver,
  updateTruck,
} from "@/lib/data/trucks";
import type { DriverView, TruckView } from "@/lib/types";
import type { DriverInput, DriverPatch, TruckInput, TruckPatch } from "@/lib/validators/truck";

type Saved<T> = { ok: true; saved: T } | ActionFailure;
type Done = { ok: true } | ActionFailure;

/** Save a truck. Without `id` it creates one; with it, updates using expectedVersion. */
export async function saveTruckAction(args: {
  id?: string;
  expectedVersion?: number;
  input: TruckPatch;
}): Promise<Saved<TruckView>> {
  const companyId = await getActiveCompanyId();
  try {
    const truck = args.id
      ? await updateTruck(companyId, args.id, args.expectedVersion ?? -1, args.input)
      : await createTruck(companyId, { ...(args.input as TruckInput), source: "manual" });
    return { ok: true, saved: truck };
  } catch (e) {
    return toActionFailure(e);
  }
}

/** Another truck in this company with the same number (soft warning while typing). */
export async function truckOwnerAction(
  number: string,
  exceptId?: string,
): Promise<{ id: string; number: string } | null> {
  const companyId = await getActiveCompanyId();
  const found = await findTruckByNumber(companyId, number);
  return found && found.id !== exceptId ? { id: found.id, number: found.number } : null;
}

export async function cancelTruckAction(id: string): Promise<Done> {
  const companyId = await getActiveCompanyId();
  try {
    await cancelTruck(companyId, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionFailure(e);
  }
}

/** Save a driver. Without `id` it creates one; with it, updates using expectedVersion. */
export async function saveDriverAction(args: {
  id?: string;
  expectedVersion?: number;
  input: DriverPatch;
}): Promise<Saved<DriverView>> {
  const companyId = await getActiveCompanyId();
  try {
    const driver = args.id
      ? await updateDriver(companyId, args.id, args.expectedVersion ?? -1, args.input)
      : await createDriver(companyId, args.input as DriverInput);
    return { ok: true, saved: driver };
  } catch (e) {
    return toActionFailure(e);
  }
}

export async function cancelDriverAction(id: string): Promise<Done> {
  const companyId = await getActiveCompanyId();
  try {
    await cancelDriver(companyId, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionFailure(e);
  }
}

/** Placeholder for "Invite to driver app": records invitedAt, sends nothing yet. */
export async function inviteDriverAction(id: string): Promise<Saved<DriverView>> {
  const companyId = await getActiveCompanyId();
  try {
    return { ok: true, saved: await inviteDriver(companyId, id) };
  } catch (e) {
    return toActionFailure(e);
  }
}

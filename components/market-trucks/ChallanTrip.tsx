"use client";

// "Trip" section of the challan page (above POD): driver app link + trip event timeline, and a form
// for office staff to mark Loaded / On the way / Reached for a driver without a smartphone.
import { useState, useTransition } from "react";
import { addStaffTripEventAction } from "@/app/(app)/market-trucks/driver-link-actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Field, Select } from "@/components/ui/Field";
import { formatDateTime } from "@/lib/driver-app/format";
import type { TripEvent, TripEventType } from "@/lib/types";
import { DriverLinkPanel, mapsPointUrl } from "./DriverLinkPanel";
import { TRIP_LABEL, TRIP_TONE } from "./trip-labels";


export function ChallanTrip({
  challanId,
  events: initial,
  driver,
  canEdit,
}: {
  challanId: string;
  events: TripEvent[];
  driver: { id: string; name: string; mobile: string | null } | null;
  /** master.edit — Send/Copy/Revoke and the add-update form; the timeline and last seen need only freight.view */
  canEdit: boolean;
}) {
  const [events, setEvents] = useState(initial);
  const [type, setType] = useState<TripEventType>("loaded");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));

  function add() {
    setError(null);
    startTransition(async () => {
      const r = await addStaffTripEventAction(challanId, type, note.trim() || null);
      if (!r.ok) return setError(r.message);
      setEvents((p) => [...p.filter((e) => e.id !== r.event.id), r.event]);
      setNote("");
    });
  }

  return (
    <div id="trip" className="mt-5 scroll-mt-4">
      <Card title="Trip" description="Loaded, on the way and reached — from the driver's link or marked by the office.">
        <div className="flex flex-col gap-4">
          {driver ? (
            <DriverLinkPanel driverId={driver.id} driverName={driver.name} mobile={driver.mobile} canEdit={canEdit} />
          ) : (
            <Alert tone="warning" title="No driver on this challan — add one to send the app link." />
          )}

          <section aria-label="Trip events" className="border-t border-border pt-4">
            {sorted.length === 0 ? (
              <p className="m-0 text-sm text-muted">No trip updates yet.</p>
            ) : (
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {sorted.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <Chip tone={TRIP_TONE[e.type]}>{TRIP_LABEL[e.type]}</Chip>
                    <span>{formatDateTime(e.at)}</span>
                    <span className="text-muted">{e.source === "driver_link" ? "Driver" : "Staff"}</span>
                    {e.lat !== null && e.lng !== null && (
                      <a
                        href={mapsPointUrl(e.lat, e.lng)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold underline"
                      >
                        Open in Maps
                      </a>
                    )}
                    {e.note && <span className="text-muted">· {e.note}</span>}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {canEdit && (
            <section aria-label="Add trip update" className="border-t border-border pt-4">
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[12rem_1fr_auto]">
                <Select label="Update" value={type} onChange={(e) => setType(e.target.value as TripEventType)}>
                  {(Object.keys(TRIP_LABEL) as TripEventType[]).map((t) => (
                    <option key={t} value={t}>
                      {TRIP_LABEL[t]}
                    </option>
                  ))}
                </Select>
                <Field label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
                <Button onClick={add} disabled={pending}>
                  {pending ? "Saving…" : "Add update"}
                </Button>
              </div>
              {error && (
                <p role="alert" className="m-0 mt-2 text-[13px] text-danger">
                  {error}
                </p>
              )}
            </section>
          )}
        </div>
      </Card>
    </div>
  );
}

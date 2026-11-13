"use client";

import { useState } from "react";
import type { DriverTrip, TripEventType } from "@/lib/types";
import { ApiError } from "@/lib/driver-app/api";
import { formatDateTime } from "@/lib/driver-app/format";
import { useDriver } from "./DriverProvider";
import { btnOutline, btnPrimary } from "./ui";

const TYPES: TripEventType[] = ["loaded", "en_route", "reached"];

/** Loaded / On the way / Reached. Always saves; with no network it waits in the phone and is sent later. */
export function StatusButtons({ token, trip, reload }: { token: string; trip: DriverTrip; reload: () => Promise<void> }) {
  const { t, sendEvent, queue } = useDriver();
  const [busy, setBusy] = useState<TripEventType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const timeOf = (type: TripEventType): string | null => {
    const times = trip.events.filter((e) => e.type === type).map((e) => e.at);
    return times.length ? times.sort().at(-1)! : null;
  };

  async function tap(type: TripEventType) {
    setBusy(type);
    setError(null);
    try {
      await sendEvent(token, trip.challanId, type);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("loadError"));
      void reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-2">
        {TYPES.map((type) => {
          const queued = queue.find((q) => q.token === token && q.challanId === trip.challanId && q.type === type);
          const at = timeOf(type);
          return (
            <div key={type}>
              <button
                type="button"
                disabled={trip.readOnly || busy !== null}
                aria-busy={busy === type}
                onClick={() => void tap(type)}
                className={`${at && !queued ? btnOutline : btnPrimary} w-full`}
              >
                {busy === type ? t("saving") : `${at && !queued ? "✓ " : ""}${t(type)}`}
              </button>
              <p className="mt-1 min-h-6 text-center text-base text-muted">
                {queued ? <span className="text-warning">{t("willSend")} · {formatDateTime(queued.tappedAt)}</span> : at ? formatDateTime(at) : ""}
              </p>
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-2 text-base text-red-700">{error}</p>}
    </div>
  );
}

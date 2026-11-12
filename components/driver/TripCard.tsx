"use client";

import type { DriverTrip } from "@/lib/types";
import { formatDate } from "@/lib/driver-app/format";
import { useDriver } from "./DriverProvider";
import { card, chipNeutral, chipOk, chipWarn } from "./ui";

export const humanStatus = (s: string) => s.replace(/_/g, " ");

export function TripCard({ trip, onOpen }: { trip: DriverTrip; onOpen: () => void }) {
  const { t } = useDriver();
  const podChip = trip.podStatus === "pending" || trip.podStatus === "partial" ? chipWarn : chipOk;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${card} block w-full text-left active:opacity-80 ${trip.readOnly ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-xl font-semibold">
          {t("challan")} {trip.challanNo}
        </p>
        <span className={chipNeutral}>{humanStatus(trip.status)}</span>
      </div>
      <p className="mt-1 font-mono text-lg">{trip.vehicleNo ?? "—"}</p>
      <p className="text-base">
        {trip.source ?? "—"} → {trip.destination ?? "—"}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className={podChip}>{t(`pod_${trip.podStatus}` as const)}</span>
        <span className="text-sm text-muted">{formatDate(trip.challanDate)}</span>
      </div>
      {trip.readOnly && <p className="mt-1 text-sm text-muted">{t("readOnly")}</p>}
    </button>
  );
}

"use client";

import type { DriverTrip, DriverTripLr, DriverTripParty } from "@/lib/types";
import { formatDate, mapsUrl } from "@/lib/driver-app/format";
import { useDriver } from "./DriverProvider";
import { EwayCountdown } from "./EwayCountdown";
import { PodUpload } from "./PodUpload";
import { StatusButtons } from "./StatusButtons";
import { humanStatus } from "./TripCard";
import { btnOutline, btnSoft, card, chipNeutral } from "./ui";

function PartyBlock({ title, mapsLabel, party }: { title: string; mapsLabel: string; party: DriverTripParty }) {
  const { t } = useDriver();
  const address = [party.address, party.place, party.pincode].filter(Boolean).join(", ");
  const maps = mapsUrl(party.address, party.place, party.pincode);
  return (
    <div className="rounded-lg bg-page p-3">
      <p className="text-sm font-semibold uppercase text-muted">{title}</p>
      {party.name && <p className="font-semibold">{party.name}</p>}
      <p className="text-base">{address || "—"}</p>
      <div className="mt-2 grid grid-cols-1 gap-2">
        {maps && (
          <a href={maps} target="_blank" rel="noopener noreferrer" className={btnSoft}>
            📍 {mapsLabel}
          </a>
        )}
        {party.phone && (
          <a href={`tel:${party.phone}`} className={btnOutline}>
            📞 {t("call")} {party.phone}
          </a>
        )}
      </div>
    </div>
  );
}

function LrBlock({ token, trip, lr, reload }: { token: string; trip: DriverTrip; lr: DriverTripLr; reload: () => Promise<void> }) {
  const { t } = useDriver();
  return (
    <section className={`${card} flex flex-col gap-3`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-xl font-semibold">
          {t("lr")} {lr.lrNo}
        </p>
        <span className="text-base text-muted">
          {lr.fromPlace ?? "—"} → {lr.toPlace ?? "—"}
        </span>
      </div>

      <PartyBlock title={`${t("pickup")} · ${t("consignor")}`} mapsLabel={t("openMaps")} party={lr.consignor} />
      <PartyBlock title={`${t("delivery")} · ${t("consignee")}`} mapsLabel={t("openMaps")} party={lr.consignee} />

      <div>
        <p className="text-sm font-semibold uppercase text-muted">{t("goods")}</p>
        {lr.goods.map((g, i) => (
          <p key={i} className="text-base">
            {g.description} — {g.packages}
            {g.weight ? ` · ${g.weight} kg` : ""}
          </p>
        ))}
        <p className="mt-1 text-base font-semibold">
          {t("packages")}: {lr.packages}
          {lr.weight ? ` · ${t("weight")}: ${lr.weight} kg` : ""}
        </p>
      </div>

      {lr.ewayBillNo && <EwayCountdown no={lr.ewayBillNo} expiresAt={lr.ewayExpiresAt} />}

      {(lr.podFiles > 0 || lr.deliveredOn) && (
        <p className="text-base text-success">
          {lr.podFiles > 0 ? t("podFiles", { n: lr.podFiles }) : ""}
          {lr.deliveredOn ? ` · ${t("deliveredOn")}: ${formatDate(lr.deliveredOn)}` : ""}
        </p>
      )}

      {!trip.readOnly && <PodUpload token={token} challanId={trip.challanId} lr={lr} onDone={reload} />}
    </section>
  );
}

export function TripDetail({
  token,
  trip,
  reload,
  onBack,
}: {
  token: string;
  trip: DriverTrip;
  reload: () => Promise<void>;
  onBack: () => void;
}) {
  const { t } = useDriver();
  return (
    <div className={`flex flex-col gap-4 ${trip.readOnly ? "opacity-70" : ""}`}>
      <button type="button" onClick={onBack} className={`${btnOutline} self-start`}>
        ← {t("back")}
      </button>

      <section className={card}>
        <div className="flex items-start justify-between gap-2">
          <p className="font-mono text-xl font-semibold">
            {t("challan")} {trip.challanNo}
          </p>
          <span className={chipNeutral}>{humanStatus(trip.status, t)}</span>
        </div>
        <p className="mt-1 font-mono text-lg">{trip.vehicleNo ?? "—"}</p>
        <p className="text-base">
          {trip.source ?? "—"} → {trip.destination ?? "—"}
        </p>
        <p className="mt-1 text-base">
          <span className="text-muted">{t("advance")}: </span>
          <span className="font-semibold">₹ {trip.advancePaid}</span>
        </p>
        {trip.readOnly && <p className="mt-1 text-sm text-muted">{t("readOnly")}</p>}
      </section>

      {/* Read-only trips still show the recorded times; their buttons are disabled. */}
      <section className={card}>
        <StatusButtons token={token} trip={trip} reload={reload} />
      </section>

      {trip.lrs.map((lr) => (
        <LrBlock key={lr.lrId} token={token} trip={trip} lr={lr} reload={reload} />
      ))}
    </div>
  );
}

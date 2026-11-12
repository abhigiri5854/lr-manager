"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DriverLinkInfo, DriverTrip } from "@/lib/types";
import { useDriver } from "./DriverProvider";
import { HistoryPanel } from "./HistoryPanel";
import { LocationNotice } from "./LocationNotice";
import { TripCard } from "./TripCard";
import { TripDetail } from "./TripDetail";
import { btnPrimary, card, input, LangToggle, Notices, Screen } from "./ui";

type Tab = "trips" | "dashboard" | "history";

export function CompanyScreen({
  token,
  driver,
  trips,
  reload,
}: {
  token: string;
  driver: DriverLinkInfo;
  trips: DriverTrip[];
  reload: () => Promise<void>;
}) {
  const { t, links, queue } = useDriver();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("trips");
  const [selected, setSelected] = useState<string | null>(null);
  const trip = trips.find((x) => x.challanId === selected) ?? null;

  const tabs: Array<[Tab, "tabTrips" | "tabDashboard" | "tabHistory"]> = [
    ["trips", "tabTrips"],
    ["dashboard", "tabDashboard"],
    ["history", "tabHistory"],
  ];

  return (
    <Screen>
      <header className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold">{driver.driverName}</h1>
            <p className="truncate text-base text-muted">{driver.companyName}</p>
          </div>
          <LangToggle />
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {driver.officePhone && (
            <a href={`tel:${driver.officePhone}`} className={`${btnPrimary} w-full`}>
              📞 {t("callOffice")}
            </a>
          )}
          <select
            aria-label={t("changeCompany")}
            className={input}
            value={token}
            onChange={(e) => router.push(e.target.value ? `/d/${e.target.value}` : "/d")}
          >
            {links.map((l) => (
              <option key={l.token} value={l.token}>
                {l.companyName} – {l.driverName}
              </option>
            ))}
            <option value="">{t("allCompanies")}</option>
          </select>
        </div>
      </header>

      <Notices />
      <LocationNotice />
      {queue.length > 0 && <p className="mb-3 text-base text-warning">{t("queued", { n: queue.length })}</p>}

      <nav className="mb-4 grid grid-cols-3 gap-2" aria-label="tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id}
            onClick={() => {
              setTab(id);
              setSelected(null);
            }}
            className={`min-h-14 rounded-lg px-2 text-base font-semibold ${
              tab === id ? "bg-primary text-white" : "border border-border bg-surface text-primary"
            }`}
          >
            {t(label)}
          </button>
        ))}
      </nav>

      {tab === "trips" &&
        (trip ? (
          <TripDetail token={token} trip={trip} reload={reload} onBack={() => setSelected(null)} />
        ) : trips.length === 0 ? (
          <p className={`${card} text-center text-muted`}>{t("noTrips")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {trips.map((x) => (
              <li key={x.challanId}>
                <TripCard trip={x} onOpen={() => setSelected(x.challanId)} />
              </li>
            ))}
          </ul>
        ))}

      {tab !== "trips" && <HistoryPanel token={token} mode={tab} />}
    </Screen>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchTrips, isLinkGone } from "@/lib/driver-app/api";
import { formatDate } from "@/lib/driver-app/format";
import { useDriver } from "./DriverProvider";
import { LocationNotice } from "./LocationNotice";
import { card, chipNeutral, LangToggle, Notices, Screen } from "./ui";

/** /d — one card per saved company. Saved links that stopped working are announced once and removed. */
export function DriverHome() {
  const { t, links, hydrated, dropLink, syncVersion, queue } = useDriver();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const tokenKey = links.map((l) => l.token).join(",");

  useEffect(() => {
    if (!hydrated || !tokenKey) return;
    let dead = false;
    for (const token of tokenKey.split(",")) {
      fetchTrips(token)
        .then((r) => {
          if (!dead) setCounts((c) => ({ ...c, [token]: r.trips.filter((x) => !x.readOnly).length }));
        })
        .catch((e: unknown) => {
          if (!dead && isLinkGone(e)) dropLink(token, true);
        });
    }
    return () => {
      dead = true;
    };
  }, [hydrated, tokenKey, syncVersion, dropLink]);

  return (
    <Screen>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("appName")}</h1>
        <LangToggle />
      </header>
      <Notices />
      <LocationNotice />
      {queue.length > 0 && <p className="mb-3 text-base text-warning">{t("queued", { n: queue.length })}</p>}

      {hydrated && links.length === 0 && <p className={`${card} text-center`}>{t("noLinks")}</p>}

      <ul className="flex flex-col gap-3">
        {links.map((l) => (
          <li key={l.token}>
            <Link href={`/d/${l.token}`} className={`${card} block active:opacity-80`}>
              <p className="text-xl font-semibold">{l.companyName}</p>
              <p className="text-base text-muted">{l.driverName}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className={chipNeutral}>{t("activeTrips", { n: counts[l.token] ?? "…" })}</span>
                <span className="text-sm text-muted">{t("added", { date: formatDate(l.addedAt) })}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

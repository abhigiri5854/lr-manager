"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DriverHistoryTrip } from "@/lib/types";
import { fetchHistory } from "@/lib/driver-app/api";
import { formatDate } from "@/lib/driver-app/format";
import { useDriver } from "./DriverProvider";
import { btnOutline, btnPrimary, card, chipNeutral, chipOk } from "./ui";

const PAGE = 20;

/** Dashboard (this month) and History (settled / cancelled trips, read-only, "Load more"). */
export function HistoryPanel({ token, mode }: { token: string; mode: "dashboard" | "history" }) {
  const { t } = useDriver();
  const [trips, setTrips] = useState<DriverHistoryTrip[]>([]);
  const [summary, setSummary] = useState<{ tripsThisMonth: number; podsPending: number; historyDays: number } | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);

  const load = useCallback(
    async (before: string | null) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      setError(false);
      try {
        const h = await fetchHistory(token, before);
        setSummary({ tripsThisMonth: h.tripsThisMonth, podsPending: h.podsPending, historyDays: h.historyDays });
        setTrips((prev) => (before ? [...prev, ...h.trips] : h.trips));
        setMore(h.trips.length >= PAGE);
      } catch {
        setError(true);
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load(null); // fresh numbers every time the tab opens
  }, [load, mode]);

  if (error)
    return (
      <div className={`${card} text-center`}>
        <p>{t("loadError")}</p>
        <button type="button" className={`${btnPrimary} mt-3`} onClick={() => void load(trips.at(-1)?.challanDate ?? null)}>
          {t("retry")}
        </button>
      </div>
    );
  if (!summary) return <p className="py-10 text-center text-muted">{t("loading")}</p>;

  if (mode === "dashboard")
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className={card}>
          <p className="text-4xl font-bold text-primary">{summary.tripsThisMonth}</p>
          <p className="text-base text-muted">{t("thisMonth")}</p>
        </div>
        <div className={card}>
          <p className="text-4xl font-bold text-primary">{summary.podsPending}</p>
          <p className="text-base text-muted">{t("podsPending")}</p>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("historyDays", { n: summary.historyDays })}</p>
      {trips.length === 0 && <p className={`${card} text-center text-muted`}>{t("noHistory")}</p>}
      {trips.map((x, i) => (
        <div key={`${x.challanNo}-${i}`} className={`${card} opacity-70`}>
          <div className="flex items-start justify-between gap-2">
            <p className="font-mono text-lg font-semibold">
              {t("challan")} {x.challanNo}
            </p>
            <span className={x.status === "settled" ? chipOk : chipNeutral}>{x.status}</span>
          </div>
          <p className="font-mono">{x.vehicleNo ?? "—"}</p>
          <p className="text-base">
            {x.source ?? "—"} → {x.destination ?? "—"}
          </p>
          <p className="text-sm text-muted">
            {formatDate(x.challanDate)} · {x.podDone ? t("podDone") : t("pod_pending")}
          </p>
        </div>
      ))}
      {more && (
        <button type="button" className={`${btnOutline} w-full`} disabled={loading} onClick={() => void load(trips.at(-1)?.challanDate ?? null)}>
          {loading ? t("loading") : t("loadMore")}
        </button>
      )}
    </div>
  );
}

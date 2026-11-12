"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DriverLinkInfo, DriverTrip } from "@/lib/types";
import { fetchTrips, isLinkGone } from "@/lib/driver-app/api";
import { CompanyScreen } from "./CompanyScreen";
import { useDriver } from "./DriverProvider";
import { InvalidLink } from "./InvalidLink";
import { btnPrimary, card, Screen } from "./ui";

type State =
  | { kind: "loading" }
  | { kind: "invalid"; company: string | null }
  | { kind: "error" }
  | { kind: "ready"; driver: DriverLinkInfo; trips: DriverTrip[] };

/** /d/<token>: validate the link, add or update it in the saved list, then show that company. */
export function CompanyEntry({ token }: { token: string }) {
  const { hydrated, saveLink, dropLink, syncVersion, t } = useDriver();
  const [state, setState] = useState<State>({ kind: "loading" });
  const opened = useRef(false);

  const load = useCallback(async () => {
    const first = !opened.current;
    try {
      const r = await fetchTrips(token, first);
      opened.current = true;
      if (first) saveLink({ token, companyName: r.driver.companyName, driverName: r.driver.driverName, officePhone: r.driver.officePhone });
      setState({ kind: "ready", driver: r.driver, trips: r.trips });
    } catch (e) {
      if (isLinkGone(e)) {
        // Saved before? Say so once ("<company> closed the link") and forget it.
        const gone = dropLink(token, false);
        setState({ kind: "invalid", company: gone?.companyName ?? null });
      } else {
        setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
      }
    }
  }, [token, saveLink, dropLink]);

  useEffect(() => {
    if (!hydrated) return;
    void load();
  }, [hydrated, load, syncVersion]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  if (state.kind === "invalid") return <InvalidLink company={state.company} />;
  if (state.kind === "ready") return <CompanyScreen token={token} driver={state.driver} trips={state.trips} reload={load} />;
  return (
    <Screen>
      {state.kind === "error" ? (
        <div className={`${card} text-center`}>
          <p>{t("loadError")}</p>
          <button type="button" className={`${btnPrimary} mt-3`} onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      ) : (
        <p className="py-16 text-center text-muted">{t("loading")}</p>
      )}
    </Screen>
  );
}

"use client";

import { useDriver } from "./DriverProvider";
import { btnPrimary, card } from "./ui";

// Location is asked once, after this explainer is tapped; afterwards it is automatic.
export function LocationNotice() {
  const { perm, gpsUnavailable, requestLocation, t } = useDriver();

  if (perm === "prompt") {
    return (
      <section className={`${card} mb-4`}>
        <p className="font-semibold">{t("locExplain")}</p>
        <p className="mt-1 text-base text-muted">{t("locOnlyOpen")}</p>
        <button type="button" className={`${btnPrimary} mt-3 w-full`} onClick={() => void requestLocation()}>
          {t("locButton")}
        </button>
      </section>
    );
  }
  if (perm === "denied") {
    return (
      <section className={`${card} mb-4`}>
        <p className="font-semibold">{t("locDenied")}</p>
        <p className="mt-1 text-base text-muted">{t("locSteps")}</p>
      </section>
    );
  }
  if (perm === "granted" && gpsUnavailable) {
    return (
      <section className={`${card} mb-4`}>
        <p className="font-semibold">{t("locUnavailable")}</p>
      </section>
    );
  }
  return null;
}

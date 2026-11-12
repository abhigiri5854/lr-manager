"use client";

import { useEffect, useState } from "react";
import { formatDateTime, formatLeft } from "@/lib/driver-app/format";
import { useDriver } from "./DriverProvider";

const SIX_HOURS = 6 * 60 * 60_000;

/** E-way bill number with its expiry: red under 6 hours, "expired" afterwards. */
export function EwayCountdown({ no, expiresAt }: { no: string; expiresAt: string | null }) {
  const { t } = useDriver();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const left = expiresAt && now !== null ? new Date(expiresAt).getTime() - now : null;
  const expired = left !== null && left <= 0;
  const urgent = left !== null && left < SIX_HOURS;

  return (
    <p className="text-base">
      <span className="text-muted">{t("eway")}: </span>
      <span className="font-mono font-semibold">{no}</span>
      {expiresAt && left !== null && (
        <span className={`ml-2 font-semibold ${urgent ? "text-red-700" : "text-success"}`}>
          {expired ? t("ewayExpired") : t("ewayLeft", { left: formatLeft(left) })}
          <span className="ml-1 font-normal text-muted">({formatDateTime(expiresAt)})</span>
        </span>
      )}
    </p>
  );
}

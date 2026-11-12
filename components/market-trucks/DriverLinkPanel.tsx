"use client";

// A market driver's app link: status (Active / Revoked / Not sent, last opened, last seen) and the
// Send on WhatsApp / Copy / Revoke buttons. Used in the driver edit dialog and the challan Trip section.
import { useEffect, useState, useTransition } from "react";
import {
  driverLinkStatusAction,
  getDriverLinkAction,
  revokeDriverLinkAction,
} from "@/app/(app)/market-trucks/driver-link-actions";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Dialog } from "@/components/ui/Dialog";
import { formatDateTime } from "@/lib/driver-app/format";
import { whatsappLink } from "@/lib/truck-payment-share";
import type { DriverLinkStatus } from "@/lib/types";

export function mapsPointUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** "just now" / "20 min ago" / "3 h ago" / "2 d ago" */
export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  return `${Math.floor(mins / 1440)} d ago`;
}

function whatsappText(name: string, url: string): string {
  return `नमस्ते ${name},\nआपका ट्रिप लिंक: ${url}\nलिंक खोलें → 'Add to Home screen' दबाएँ → लोकेशन 'Allow' करें`;
}

const hasMobile = (m: string | null) => (m ?? "").replace(/\D/g, "").length >= 10;

export function DriverLinkPanel({
  driverId,
  driverName,
  mobile,
  canEdit,
}: {
  driverId: string;
  driverName: string;
  mobile: string | null;
  /** master.edit */
  canEdit: boolean;
}) {
  const [status, setStatus] = useState<DriverLinkStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [waHref, setWaHref] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void driverLinkStatusAction(driverId).then((r) => {
      if (!live) return;
      if (r.ok) setStatus(r.status);
      else {
        setStatus(null);
        setError(r.message);
      }
    });
    return () => {
      live = false;
    };
  }, [driverId]);

  const reloadStatus = async () => {
    const r = await driverLinkStatusAction(driverId);
    if (r.ok) setStatus(r.status);
  };

  function send() {
    setError(null);
    setNotice(null);
    setWaHref(null);
    startTransition(async () => {
      const r = await getDriverLinkAction(driverId);
      if (!r.ok) return setError(r.message);
      const href = whatsappLink(whatsappText(driverName, r.url), mobile);
      const w = window.open(href, "_blank");
      if (!w) setWaHref(href); // popup blocked: let the user click
      await reloadStatus();
    });
  }

  function copy() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await getDriverLinkAction(driverId);
      if (!r.ok) return setError(r.message);
      try {
        await navigator.clipboard.writeText(r.url);
        setNotice("Link copied.");
      } catch {
        setError("Couldn't copy — copy it from the address you send instead.");
      }
      await reloadStatus();
    });
  }

  function revoke() {
    setConfirmRevoke(false);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await revokeDriverLinkAction(driverId);
      if (!r.ok) return setError(r.message);
      setNotice("Link revoked.");
      await reloadStatus();
    });
  }

  const noMobile = !hasMobile(mobile);
  const active = status?.status === "active";

  return (
    <section aria-label="Driver app link" className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-text-strong">App link</b>
        {status === undefined ? (
          <span className="text-muted">Checking…</span>
        ) : status === null ? (
          <Chip tone="grey">Not sent</Chip>
        ) : (
          <Chip tone={active ? "green" : "amber"}>{active ? "Active" : "Revoked"}</Chip>
        )}
      </div>
      {status && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] text-muted">
          <li>Last opened: {status.lastOpenedAt ? timeAgo(status.lastOpenedAt) : "never"}</li>
          <li>
            Last seen:{" "}
            {status.lastLocatedAt ? (
              <>
                {timeAgo(status.lastLocatedAt)}
                {status.lastLat !== null && status.lastLng !== null && (
                  <>
                    {" · "}
                    <a
                      href={mapsPointUrl(status.lastLat, status.lastLng)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline"
                    >
                      Open in Maps
                    </a>
                  </>
                )}
              </>
            ) : (
              "never"
            )}
          </li>
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={send} disabled={pending || noMobile}>
            Send app link on WhatsApp
          </Button>
          <Button variant="secondary" onClick={copy} disabled={pending}>
            Copy link
          </Button>
          {active && (
            <Button variant="secondary" onClick={() => setConfirmRevoke(true)} disabled={pending}>
              Revoke link
            </Button>
          )}
        </div>
      )}
      {canEdit && noMobile && (
        <p className="m-0 text-[13px] text-warning">Add the driver&apos;s mobile number to send the link on WhatsApp.</p>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
      {waHref && (
        <div>
          <Button variant="secondary" href={waHref} newTab>
            Open WhatsApp
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="m-0 text-[13px] text-success">
          {notice}
        </p>
      )}
      <Dialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        title="Revoke this link?"
        description={`${driverName} won't be able to open the app with the old link. You can send a new one later.`}
      >
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmRevoke(false)}>
            Keep link
          </Button>
          <Button variant="dark" onClick={revoke} disabled={pending}>
            Revoke
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

export { formatDateTime };

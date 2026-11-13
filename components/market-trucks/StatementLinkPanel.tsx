"use client";

// A truck party's statement link: status (Active / Revoked / Not sent, last opened) and the
// Send on WhatsApp / Copy / Revoke buttons. Same pattern as DriverLinkPanel.
import { useEffect, useState, useTransition } from "react";
import {
  getStatementLinkAction,
  revokeStatementLinkAction,
  statementLinkStatusAction,
} from "@/app/(app)/market-trucks/parties/statement-link-actions";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Dialog } from "@/components/ui/Dialog";
import type { PartyStatementLinkStatus } from "@/lib/data/party-statements";
import { formatRupees } from "@/lib/format";
import { whatsappLink } from "@/lib/truck-payment-share";
import { timeAgo } from "./DriverLinkPanel";

function whatsappText(name: string, company: string, balancePaise: number, url: string): string {
  return `नमस्ते ${name}, ${company} में आपका हिसाब: बकाया ${formatRupees(balancePaise)}. पूरा विवरण: ${url}`;
}

const hasMobile = (m: string | null) => (m ?? "").replace(/\D/g, "").length >= 10;

export function StatementLinkPanel({
  partyId,
  partyName,
  companyName,
  mobile,
  balancePaise,
  canEdit,
}: {
  partyId: string;
  partyName: string;
  companyName: string;
  mobile: string | null;
  balancePaise: number;
  /** master.edit */
  canEdit: boolean;
}) {
  const [status, setStatus] = useState<PartyStatementLinkStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [waHref, setWaHref] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [acting, setActing] = useState<"send" | "copy" | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    statementLinkStatusAction(partyId)
      .then((r) => {
        if (!live) return;
        if (r.ok) setStatus(r.status);
        else {
          setStatus(null);
          setError(r.message);
        }
      })
      .catch(() => {
        if (!live) return;
        setStatus(null);
        setError("Could not load the link status. Please reload the page.");
      });
    return () => {
      live = false;
    };
  }, [partyId]);

  const reloadStatus = async () => {
    try {
      const r = await statementLinkStatusAction(partyId);
      if (r.ok) setStatus(r.status);
    } catch {
      /* status stays as it was */
    }
  };

  /** Runs a server action; a thrown error (stale build, network) becomes an inline message. */
  function run(fn: () => Promise<void>) {
    setError(null);
    setNotice(null);
    setWaHref(null);
    startTransition(async () => {
      try {
        await fn();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  function send() {
    setActing("send");
    run(async () => {
      const r = await getStatementLinkAction(partyId);
      if (!r.ok) return setError(r.message);
      const href = whatsappLink(whatsappText(partyName, companyName, balancePaise, r.url), mobile);
      const w = window.open(href, "_blank");
      if (!w) setWaHref(href); // popup blocked: let the user click
      await reloadStatus();
    });
  }

  function copy() {
    setActing("copy");
    run(async () => {
      const r = await getStatementLinkAction(partyId);
      if (!r.ok) return setError(r.message);
      try {
        await navigator.clipboard.writeText(r.url);
        setNotice("Link copied.");
      } catch {
        setError("Could not copy the link. Please try again.");
      }
      await reloadStatus();
    });
  }

  function revoke() {
    setConfirmRevoke(false);
    run(async () => {
      const r = await revokeStatementLinkAction(partyId);
      if (!r.ok) return setError(r.message);
      setNotice("Link revoked.");
      await reloadStatus();
    });
  }

  const noMobile = !hasMobile(mobile);
  const active = status?.status === "active";

  return (
    <section aria-label="Statement link" className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-text-strong">Statement link</b>
        {status === undefined ? (
          <span className="text-muted">Checking…</span>
        ) : status === null ? (
          <Chip tone="grey">Not sent</Chip>
        ) : (
          <Chip tone={active ? "green" : "amber"}>
            {status.status === "active" ? "Active" : status.status === "expired" ? "Expired" : "Revoked"}
          </Chip>
        )}
      </div>
      {status && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] text-muted">
          <li>Last opened: {status.lastOpenedAt ? timeAgo(status.lastOpenedAt) : "never"}</li>
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={send} disabled={pending || noMobile}>
            {pending && acting === "send" ? "…" : "Send statement on WhatsApp"}
          </Button>
          <Button variant="secondary" onClick={copy} disabled={pending}>
            {pending && acting === "copy" ? "…" : "Copy link"}
          </Button>
          {active && (
            <Button variant="secondary" onClick={() => setConfirmRevoke(true)} disabled={pending}>
              Revoke link
            </Button>
          )}
        </div>
      )}
      {canEdit && noMobile && (
        <p className="m-0 text-[13px] text-warning">
          Add the party&apos;s mobile number to send the statement on WhatsApp.
        </p>
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
        description={`${partyName} won't be able to open the statement with the old link. You can send a new one later.`}
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

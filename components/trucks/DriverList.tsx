"use client";

import { useState, useTransition } from "react";
import { inviteDriverAction } from "@/app/(app)/trucks/actions";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { useSavedRows } from "@/components/ui/useSavedRows";
import { IfCan } from "@/components/ui/Permissions";
import { formatDate } from "@/lib/format";
import type { DriverRow, DriverView, IsoDate } from "@/lib/types";
import { DriverForm } from "./DriverForm";
import { ExpiryCell } from "./ExpiryCell";
import { LinkButton } from "./LinkButton";

/**
 * "Invite to driver app" is a placeholder: it records when the invite was made. No SMS is
 * sent until messaging exists.
 */
function InviteCell({
  driver,
  onSaved,
}: {
  driver: DriverRow;
  onSaved: (saved: DriverView) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {driver.invitedAt && <>Invited {formatDate(driver.invitedAt)} · </>}
      <LinkButton
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await inviteDriverAction(driver.id);
            setError(result.ok ? null : result.message);
            if (result.ok) onSaved(result.saved);
          })
        }
      >
        {pending ? "Inviting…" : driver.invitedAt ? "Invite again" : "Invite to driver app"}
      </LinkButton>
      {error && <div className="text-[13px] text-danger">{error}</div>}
    </>
  );
}

/** Drivers table with its Edit dialog. */
export function DriverList({
  rows: serverRows,
  today,
  empty,
}: {
  rows: DriverRow[];
  today: IsoDate;
  empty: React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { rows, remember, refreshInBackground } = useSavedRows(serverRows);
  const close = () => setOpenId(null);
  /** Saved: show it now; the truck list (driver names) catches up in the background. */
  const done = (saved?: DriverView) => {
    close();
    if (saved) {
      remember(saved);
      refreshInBackground();
    }
  };
  const current = openId ? rows.find((r) => r.id === openId) : undefined;

  const columns: Column<DriverRow>[] = [
    { key: "mobile", header: "Mobile", cell: (r) => r.mobile },
    { key: "name", header: "Name", cell: (r) => r.name ?? "—" },
    {
      key: "licenceNo",
      header: "Licence no.",
      cell: (r) => r.licenceNo ?? "—",
      mono: true,
    },
    {
      key: "licenceExpiry",
      header: "Licence expiry",
      cell: (r) => <ExpiryCell date={r.licenceExpiry} today={today} />,
    },
    {
      key: "truck",
      header: "Usual truck",
      cell: (r) => (r.truckNumbers.length ? r.truckNumbers.join(", ") : "—"),
      mono: true,
    },
    {
      key: "app",
      header: "Driver app",
      cell: (r) => (
        <IfCan
          action="company.manage"
          fallback={r.invitedAt ? `Invited ${formatDate(r.invitedAt)}` : "Not invited"}
        >
          <InviteCell driver={r} onSaved={remember} />
        </IfCan>
      ),
    },
    {
      key: "edit",
      header: <span className="sr-only">Actions</span>,
      cell: (r) => (
        <LinkButton onClick={() => setOpenId(r.id)} aria-label={`Edit driver ${r.mobile}`}>
          Edit
        </LinkButton>
      ),
    },
  ];

  return (
    <>
      <DataTable label="Drivers" columns={columns} rows={rows} rowKey={(r) => r.id} empty={empty} />
      <Dialog
        open={!!current}
        onClose={close}
        title={current ? `Edit driver ${current.mobile}` : "Edit driver"}
        description="To change which truck a driver usually drives, set the driver on the truck."
      >
        {current && (
          <DriverForm key={`${current.id}:${current.version}`} driver={current} onDone={done} />
        )}
      </Dialog>
    </>
  );
}

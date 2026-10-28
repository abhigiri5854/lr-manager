"use client";

import { useState, useTransition } from "react";
import { inviteDriverAction } from "@/app/(app)/trucks/actions";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { formatDate } from "@/lib/format";
import type { DriverRow, IsoDate } from "@/lib/types";
import { DriverForm } from "./DriverForm";
import { ExpiryCell } from "./ExpiryCell";
import { LinkButton } from "./LinkButton";

/**
 * "Invite to driver app" is a placeholder: it records when the invite was made. No SMS is
 * sent until messaging exists.
 */
function InviteCell({ driver }: { driver: DriverRow }) {
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
  rows,
  today,
  empty,
}: {
  rows: DriverRow[];
  today: IsoDate;
  empty: React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const close = () => setOpenId(null);
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
    { key: "app", header: "Driver app", cell: (r) => <InviteCell driver={r} /> },
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
          <DriverForm key={`${current.id}:${current.version}`} driver={current} onDone={close} />
        )}
      </Dialog>
    </>
  );
}

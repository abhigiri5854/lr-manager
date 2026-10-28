"use client";

import Link from "next/link";
import { useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { recordSourceLabel } from "@/lib/labels";
import type { IsoDate, TruckRow } from "@/lib/types";
import { ExpiryCell } from "./ExpiryCell";
import { LinkButton } from "./LinkButton";
import { AssignDriverForm, TruckForm, type DriverOption } from "./TruckForm";

type Open = { kind: "edit" | "assign"; id: string } | null;

/** Trucks table with its Edit and Assign driver dialogs. */
export function TruckList({
  rows,
  driverOptions,
  today,
  empty,
}: {
  rows: TruckRow[];
  driverOptions: DriverOption[];
  /** yyyy-mm-dd, from the server, so expiry colours match between server and browser. */
  today: IsoDate;
  empty: React.ReactNode;
}) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const current = open ? rows.find((r) => r.id === open.id) : undefined;

  const columns: Column<TruckRow>[] = [
    { key: "number", header: "Truck no.", cell: (r) => <b>{r.number}</b>, mono: true },
    {
      key: "driver",
      header: "Driver",
      cell: (r) => (
        <>
          {r.driverMobile ? (
            <>
              {r.driverName && <>{r.driverName} · </>}
              {r.driverMobile}
            </>
          ) : (
            "—"
          )}{" "}
          <LinkButton
            onClick={() => setOpen({ kind: "assign", id: r.id })}
            aria-label={`${r.driverMobile ? "Change" : "Assign"} driver for ${r.number}`}
          >
            {r.driverMobile ? "Change" : "Assign"}
          </LinkButton>
        </>
      ),
    },
    {
      key: "trip",
      header: "Last / current trip",
      cell: (r) =>
        r.trip ? (
          <>
            LR <Link href={`/lr/${r.trip.lrId}`}>{r.trip.lrNo}</Link> ·{" "}
            {r.trip.status.toLowerCase()}
          </>
        ) : (
          "—"
        ),
    },
    { key: "rc", header: "RC", cell: (r) => <ExpiryCell date={r.rcExpiry} today={today} /> },
    {
      key: "insurance",
      header: "Insurance",
      cell: (r) => <ExpiryCell date={r.insuranceExpiry} today={today} />,
    },
    {
      key: "permit",
      header: "Permit",
      cell: (r) => <ExpiryCell date={r.permitExpiry} today={today} />,
    },
    {
      key: "fitness",
      header: "Fitness",
      cell: (r) => <ExpiryCell date={r.fitnessExpiry} today={today} />,
    },
    { key: "source", header: "Source", cell: (r) => <Chip>{recordSourceLabel[r.source]}</Chip> },
    {
      key: "edit",
      header: <span className="sr-only">Actions</span>,
      cell: (r) => (
        <LinkButton
          onClick={() => setOpen({ kind: "edit", id: r.id })}
          aria-label={`Edit truck ${r.number}`}
        >
          Edit
        </LinkButton>
      ),
    },
  ];

  return (
    <>
      <DataTable label="Trucks" columns={columns} rows={rows} rowKey={(r) => r.id} empty={empty} />
      <Dialog
        open={open?.kind === "edit" && !!current}
        onClose={close}
        title={current ? `Edit truck ${current.number}` : "Edit truck"}
        description="Document dates feed the Dashboard alerts 15 days before they lapse."
      >
        {current && (
          <TruckForm
            key={`${current.id}:${current.version}`}
            truck={current}
            driverOptions={driverOptions}
            onDone={close}
          />
        )}
      </Dialog>
      <Dialog
        open={open?.kind === "assign" && !!current}
        onClose={close}
        title={current ? `Driver for ${current.number}` : "Driver"}
        description="A truck has one driver at a time. Pick No driver to clear it."
      >
        {current && (
          <AssignDriverForm
            key={`${current.id}:${current.version}`}
            truck={current}
            driverOptions={driverOptions}
            onDone={close}
          />
        )}
      </Dialog>
    </>
  );
}

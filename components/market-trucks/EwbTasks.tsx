"use client";

// Open "Update Part-B" tasks (challan page and e-way page), each with a Mark done button (master.edit).
import Link from "next/link";
import { useState, useTransition } from "react";
import { markEwbTaskDoneAction } from "@/app/(app)/market-trucks/challans/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { formatDateTime } from "@/lib/driver-app/format";
import type { EwbTask } from "@/lib/data/db/ewb";

export function EwbTasks({
  tasks: initial,
  canEdit,
  showChallan,
}: {
  tasks: EwbTask[];
  canEdit: boolean;
  /** Link each task to its challan (e-way page). */
  showChallan?: boolean;
}) {
  const [tasks, setTasks] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (tasks.length === 0 && !error) return null;

  function done(id: string) {
    setError(null);
    setBusy(id);
    startTransition(async () => {
      const r = await markEwbTaskDoneAction(id);
      setBusy(null);
      if (!r.ok) return setError(r.message);
      setTasks((p) => p.filter((t) => t.id !== id));
    });
  }

  return (
    <div id="partb" className="mb-5 scroll-mt-4">
      <Card
        title={<>Update Part-B <Chip tone="amber">{tasks.length} open</Chip></>}
        description="The vehicle changed after dispatch. Update Part-B on the e-way portal before the truck moves, then mark it done."
      >
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-mono">LR {t.lrNo}</span>
              {t.ewbNo && <span className="font-mono">EWB {t.ewbNo}</span>}
              <span>
                <span className="font-mono">{t.oldVehicleNo ?? "—"}</span> →{" "}
                <span className="font-mono">{t.newVehicleNo ?? "—"}</span>
              </span>
              {showChallan && (
                <Link href={`/market-trucks/challans/${t.challanId}#partb`} className="text-primary">
                  {t.challanNo}
                </Link>
              )}
              <span className="text-muted">{formatDateTime(t.createdAt)}</span>
              {t.note && <span className="text-muted">· {t.note}</span>}
              {canEdit && (
                <Button
                  variant="secondary"
                  className="ml-auto px-3"
                  onClick={() => done(t.id)}
                  disabled={busy !== null}
                >
                  {busy === t.id ? "Saving…" : "Mark done"}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="m-0 mt-2 text-[13px] text-danger">
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}

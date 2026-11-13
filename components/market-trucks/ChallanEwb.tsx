"use client";

// "E-way bills" on the challan page: one row per LR line with an Edit form (e-way no., generated date,
// valid upto, distance). Shown once the challan is past draft (a draft edits these in the form above).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateChallanLrEwbAction } from "@/app/(app)/market-trucks/challans/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DateField } from "@/components/ui/DateField";
import { Field } from "@/components/ui/Field";
import { formatDate } from "@/lib/format";
import { formatDateTime } from "@/lib/driver-app/format";
import type { ChallanLrLine } from "@/lib/types";
import { istLocalFromIso } from "@/lib/validators/challan-ewb";

function Row({
  line,
  challanId,
  version,
  canEdit,
}: {
  line: ChallanLrLine;
  challanId: string;
  version: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [no, setNo] = useState(line.ewbNo ?? "");
  const [date, setDate] = useState(line.ewbDate ?? "");
  const [upto, setUpto] = useState(istLocalFromIso(line.ewbValidUpto));
  const [km, setKm] = useState(line.ewbDistanceKm === null ? "" : String(line.ewbDistanceKm));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await updateChallanLrEwbAction(challanId, version, {
        lrId: line.lrId,
        ewbNo: no.trim(),
        ewbDate: date.trim(),
        ewbValidUpto: upto.trim(),
        ewbDistanceKm: km.trim(),
      });
      if (!r.ok) return setError(r.message);
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <li className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <b className="font-mono">LR {line.lrNo}</b>
        {line.ewbNo ? (
          <>
            <span className="font-mono">{line.ewbNo}</span>
            <span className="text-muted">
              Generated {line.ewbDate ? formatDate(line.ewbDate) : "—"} · Valid upto{" "}
              {line.ewbValidUpto ? formatDateTime(line.ewbValidUpto) : "not entered"} ·{" "}
              {line.ewbDistanceKm === null ? "no distance" : `${line.ewbDistanceKm} km`}
            </span>
          </>
        ) : (
          <span className="text-muted">No e-way bill entered</span>
        )}
        {canEdit && !editing && (
          <Button variant="secondary" className="ml-auto px-3" onClick={() => setEditing(true)}>
            E-way bill
          </Button>
        )}
      </div>
      {editing && (
        <div className="mt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field
              label="E-way no."
              inputMode="numeric"
              maxLength={12}
              value={no}
              onChange={(e) => setNo(e.target.value)}
            />
            <DateField label="Generated on" value={date} onChange={setDate} />
            <Field
              label="Valid upto"
              type="datetime-local"
              value={upto}
              onChange={(e) => setUpto(e.target.value)}
              hint="Blank = computed from date + km"
            />
            <Field label="Distance (km)" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="m-0 mt-2 text-[13px] text-danger">
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function ChallanEwb({
  challanId,
  version,
  lines,
  canEdit,
}: {
  challanId: string;
  version: number;
  lines: ChallanLrLine[];
  /** master.edit and the challan is not settled */
  canEdit: boolean;
}) {
  if (lines.length === 0) return null;
  return (
    <div id="ewb" className="mt-5 scroll-mt-4">
      <Card title="E-way bills" description="Per LR. Valid upto left blank is computed from the generated date and distance.">
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {lines.map((l) => (
            <Row key={`${l.lrId}-${l.ewbNo ?? ""}-${l.ewbDate ?? ""}-${l.ewbValidUpto ?? ""}-${l.ewbDistanceKm ?? ""}`} line={l} challanId={challanId} version={version} canEdit={canEdit} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

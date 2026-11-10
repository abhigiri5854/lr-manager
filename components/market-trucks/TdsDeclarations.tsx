"use client";

import { useEffect, useState, useTransition } from "react";
import {
  addTdsDeclarationAction,
  listTdsDeclarationsAction,
} from "@/app/(app)/market-trucks/parties/actions";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { financialYear, fyOptions, todayInIndia } from "@/lib/fy";
import { formatDate } from "@/lib/format";
import type { TdsDeclaration } from "@/lib/types";
import { TruckDocInput } from "./TruckDocInput";

/** TDS declarations by financial year for one truck party: list + add (FY, file, details). */
export function TdsDeclarations({ partyId }: { partyId: string }) {
  const [rows, setRows] = useState<TdsDeclaration[] | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const [fyChoices] = useState(() => fyOptions(todayInIndia()));
  const [currentFy] = useState(() => financialYear(todayInIndia()));

  useEffect(() => {
    let live = true;
    void listTdsDeclarationsAction(partyId).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [partyId]);

  function add(form: HTMLFormElement) {
    const data = new FormData(form);
    const get = (k: string) => String(data.get(k) ?? "");
    startTransition(async () => {
      const result = await addTdsDeclarationAction({
        partyId,
        fy: get("fy").trim(),
        fileUrl,
        vehiclesOwnedDeclared: get("vehicles") as never,
        receivedOn: get("receivedOn"),
      });
      if (result.ok) {
        setRows((r) => [result.declaration, ...(r ?? [])].sort((a, b) => b.fy.localeCompare(a.fy)));
        setErrors({});
        setFileUrl(null);
        setFormKey((k) => k + 1);
      } else if (result.kind === "validation") {
        setErrors(Object.fromEntries(result.issues.map((i) => [i.path, i.message])));
      } else setErrors({ fy: result.message });
    });
  }

  return (
    <section className="mt-6 border-t border-border pt-4">
      <h3 className="m-0 mb-2 text-base font-semibold text-text">TDS declarations</h3>
      {rows === null ? (
        <p className="m-0 text-[13px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">No declaration on file. TDS will show a warning at payment.</p>
      ) : (
        <ul className="m-0 mb-3 list-none p-0 text-sm text-text">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-wrap justify-between gap-2 py-1">
              <span className="font-semibold">FY {d.fy}</span>
              <span className="text-muted">
                {d.vehiclesOwnedDeclared !== null && `${d.vehiclesOwnedDeclared} vehicles · `}
                {d.receivedOn ? `received ${formatDate(d.receivedOn)}` : "date not set"}
                {d.fileUrl && (
                  <>
                    {" · "}
                    <a href={d.fileUrl} target="_blank" rel="noreferrer" className="underline">
                      File
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        key={formKey}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          add(e.currentTarget);
        }}
        className="grid grid-cols-2 gap-3"
      >
        <Select label="Financial year" name="fy" defaultValue={currentFy} error={errors.fy} className="col-span-2 sm:col-span-1 [&_select]:font-mono">
          {fyChoices.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
        <Field label="Vehicles owned (declared)" name="vehicles" inputMode="numeric" error={errors.vehiclesOwnedDeclared} className="col-span-2 sm:col-span-1" />
        <Field label="Received on" name="receivedOn" type="date" error={errors.receivedOn} className="col-span-2 sm:col-span-1" />
        <div className="col-span-2 sm:col-span-1">
          <TruckDocInput label="Declaration file" kind="tds" url={fileUrl} onChange={setFileUrl} error={errors.fileUrl} />
        </div>
        <div className="col-span-2 flex justify-end">
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Adding…" : "Add declaration"}
          </Button>
        </div>
      </form>
    </section>
  );
}

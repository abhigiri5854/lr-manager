"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  applyMappingAction,
  saveMappingAction,
  setColumnMappingAction,
  setRowActionAction,
} from "@/app/(app)/import/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Select } from "@/components/ui/Field";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import type { ColumnView, ExcelReviewView, ReviewRowView } from "@/lib/data/import";
import { EXCEL_FIELDS } from "@/lib/import/fields";
import type { ImportRowAction } from "@/lib/types";

const ACTION_LABEL: Record<ImportRowAction, string> = {
  import: "Import",
  update: "Update (fill blanks)",
  skip: "Skip",
};

const MATCH: Record<ColumnView["match"], { label: string; className: string }> = {
  sure: { label: "Sure", className: "font-semibold text-success" },
  confirm: { label: "Confirm", className: "font-semibold text-warning" },
  confirmed: { label: "Confirmed", className: "font-semibold text-success" },
};

const ROWS_AT_A_TIME = 50;

/**
 * Review of one Excel file (Import.dc.html): column mapping, where the data will be saved and
 * the row review. Every change goes to the server and the whole review is recomputed there.
 */
export function ExcelReview({ view, canEdit }: { view: ExcelReviewView; canEdit: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-start gap-5">
        <MappingCard view={view} canEdit={canEdit} />
        <SavedIntoCard view={view} />
      </div>
      <RowReviewCard view={view} canEdit={canEdit} />
    </>
  );
}

// ---------- column mapping ----------
function MappingCard({ view, canEdit }: { view: ExcelReviewView; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const locked = !canEdit || view.status === "imported";

  function run(call: () => Promise<{ ok: true } | { ok: false; message: string }>, done?: string) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const r = await call();
      if (!r.ok) setError(r.message);
      else if (done) setNote(done);
    });
  }

  const columns: Column<ColumnView>[] = [
    { key: "header", header: "Column in file", cell: (c) => c.header },
    { key: "sample", header: "Sample", mono: true, wrap: true, cell: (c) => c.sample || "—" },
    {
      key: "field",
      header: "Saved into",
      cell: (c) => (
        <Select
          label={`Saved into, column ${c.header}`}
          hideLabel
          value={c.field}
          disabled={locked || pending}
          onChange={(e) =>
            run(() => setColumnMappingAction(view.batchId, c.header, e.target.value))
          }
          className="min-w-52"
        >
          {EXCEL_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: "match",
      header: "Match",
      cell: (c) => <span className={MATCH[c.match].className}>{MATCH[c.match].label}</span>,
    },
  ];

  return (
    <Card title="Excel column mapping" padding="table" className="min-w-0 flex-[1_1_520px]">
      <p className="mx-3 mt-0 mb-2 text-[13px] text-muted">
        AI matches your headers to system fields. Confirm once — saved for next upload.
      </p>
      <DataTable
        label="Excel column mapping"
        columns={columns}
        rows={view.columns}
        rowKey={(c) => c.header}
      />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveMappingAction(view.batchId, name), `Saved as “${name.trim()}”.`);
        }}
        className="mx-3 mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2"
      >
        <div className="flex items-end gap-2">
          <Field
            label="Save this mapping as"
            placeholder="e.g. RSL Booking Report"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={locked}
            className="flex-1"
          />
          <Button type="submit" variant="secondary" disabled={locked || pending || !name.trim()}>
            Save
          </Button>
        </div>
        <Select
          label="Saved mappings"
          value=""
          disabled={locked || pending || view.savedMappings.length === 0}
          onChange={(e) => {
            if (e.target.value)
              run(() => applyMappingAction(view.batchId, e.target.value), "Mapping applied.");
          }}
        >
          <option value="">
            {view.savedMappings.length ? "Use a saved mapping…" : "None saved yet"}
          </option>
          {view.savedMappings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </form>
      <div className="mx-3 mt-2 min-h-5 text-[13px]" aria-live="polite">
        {error ? (
          <span role="alert" className="text-danger">
            {error}
          </span>
        ) : note ? (
          <span className="text-success">{note}</span>
        ) : view.mappingName ? (
          <span className="text-muted">
            Using saved mapping <b>{view.mappingName}</b>.
          </span>
        ) : null}
      </div>
    </Card>
  );
}

// ---------- where the data will be saved ----------
const tile =
  "block rounded-control border border-border p-3 text-text no-underline hover:bg-page hover:text-text";

function SavedIntoCard({ view }: { view: ExcelReviewView }) {
  const s = view.savedInto;
  const n = (count: number, one: string, many = `${one}s`) =>
    `${count} ${count === 1 ? one : many}`;
  return (
    <Card
      title="Where the data will be saved"
      description="Each record goes to its own place and gets linked"
      className="flex-[1_1_380px]"
    >
      <div className="flex flex-col gap-2.5 text-sm leading-normal">
        <Link href="/lr" className={tile}>
          <b>LR register</b>
          <br />
          <span className="text-muted">
            {n(s.lrNew, "new draft LR", "new draft LRs")} from Excel
            {s.lrUpdate > 0 && ` · ${n(s.lrUpdate, "LR")} updated (blanks filled)`}
            {s.lrSkipped > 0 && ` · ${n(s.lrSkipped, "row")} skipped`}
          </span>
        </Link>
        <Link href="/invoices" className={tile}>
          <b>Tax invoices</b>
          <br />
          <span className="text-muted">
            {s.invoicesLinked > 0
              ? `${n(s.invoicesLinked, "LR")} linked to a saved tax invoice`
              : "LRs are linked to a tax invoice when its number matches"}
          </span>
        </Link>
        <Link href="/parties" className={tile}>
          <b>Parties</b>
          <br />
          <span className="text-muted">
            {s.partiesNew} new created · {s.partiesMatched} existing matched by GSTIN or name
          </span>
        </Link>
        <Link href="/trucks" className={tile}>
          <b>Trucks &amp; drivers</b>
          <br />
          <span className="text-muted">
            {s.trucksNew} new trucks added · existing ones matched by number
          </span>
        </Link>
        {view.fileUrl ? (
          <a href={view.fileUrl} className={tile}>
            <b>Documents</b>
            <br />
            <span className="text-muted">original file kept: {view.fileName}</span>
          </a>
        ) : null}
      </div>
    </Card>
  );
}

// ---------- row review ----------
function RowReviewCard({ view, canEdit }: { view: ExcelReviewView; canEdit: boolean }) {
  const [shown, setShown] = useState(ROWS_AT_A_TIME);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const locked = !canEdit || view.status === "imported";

  const columns: Column<ReviewRowView>[] = [
    { key: "source", header: "Source", cell: (r) => r.source },
    { key: "record", header: "Record", wrap: true, cell: (r) => r.record },
    {
      key: "check",
      header: "Check",
      wrap: true,
      selfClamped: true,
      cell: (r) => (
        <>
          {r.reasons.map((m) => (
            <div key={m} className={r.status === "error" ? "text-danger" : "text-warning"}>
              {m}
            </div>
          ))}
          {r.checks.length > 0 && <div className="text-success">{r.checks.join(" · ")}</div>}
          {r.reasons.length === 0 && r.checks.length === 0 && (
            <span className="text-success">Looks good</span>
          )}
        </>
      ),
    },
    {
      key: "action",
      header: "Action",
      cell: (r) =>
        r.allowed.length === 1 ? (
          <span className="text-muted">{ACTION_LABEL[r.allowed[0]]}</span>
        ) : (
          <Select
            label={`Action for ${r.source}`}
            hideLabel
            value={r.action}
            disabled={locked || pending}
            onChange={(e) => {
              setError(null);
              startTransition(async () => {
                const res = await setRowActionAction(
                  view.batchId,
                  r.rowNo,
                  e.target.value as ImportRowAction,
                );
                if (!res.ok) setError(res.message);
              });
            }}
          >
            {r.allowed.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </Select>
        ),
    },
  ];

  return (
    <Card padding="table">
      <div className="mx-3 mt-3 mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[17px] font-bold">Row review</h2>
        <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
          <Chip tone="green">Valid {view.counts.valid}</Chip>
          <Chip tone="amber">Warning {view.counts.warning}</Chip>
          <Chip tone="red">Error {view.counts.error}</Chip>
        </div>
      </div>
      <DataTable
        label="Row review"
        columns={columns}
        rows={view.rows.slice(0, shown)}
        rowKey={(r) => String(r.rowNo)}
      />
      <div className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span aria-live="polite">
          Showing {Math.min(shown, view.rows.length)} of {view.rows.length} rows · {view.importable}{" "}
          will be imported
        </span>
        <span className="flex flex-wrap gap-3">
          {shown < view.rows.length && (
            <Button variant="secondary" onClick={() => setShown((n) => n + ROWS_AT_A_TIME)}>
              Show more rows
            </Button>
          )}
          {view.counts.error > 0 && (
            <Button variant="secondary" href={`/import/${view.batchId}/errors`} download>
              Download error report (.xlsx)
            </Button>
          )}
        </span>
      </div>
      {error && (
        <p role="alert" className="mx-3 mt-2 mb-0 text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

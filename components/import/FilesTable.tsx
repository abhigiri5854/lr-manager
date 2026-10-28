"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { removeFileAction } from "@/app/(app)/import/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { formatFileSize } from "@/lib/image-upload";
import type { ImportFileRow } from "@/lib/data/import";

/** "Files read by AI": every uploaded file that isn't imported yet, with its status and next step. */
export function FilesTable({ files, canRemove }: { files: ImportFileRow[]; canRemove: boolean }) {
  const [removing, setRemoving] = useState<ImportFileRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const columns: Column<ImportFileRow>[] = [
    {
      key: "file",
      header: "File",
      cell: (f) => (
        <>
          <span className="font-mono text-[13px]">{f.fileName}</span>
          <div className="text-xs text-muted">{formatFileSize(f.sizeBytes)}</div>
        </>
      ),
    },
    { key: "format", header: "Format", cell: (f) => f.format },
    {
      key: "detected",
      header: "Detected as",
      wrap: true,
      selfClamped: true,
      cell: (f) => (
        <>
          {f.detected}
          <div className="text-[13px] text-muted">{f.found}</div>
        </>
      ),
    },
    { key: "goes", header: "Goes to", wrap: true, cell: (f) => f.goesTo },
    {
      key: "status",
      header: "Status",
      cell: (f) => <Chip tone={f.chip.tone}>{f.chip.label}</Chip>,
    },
    {
      key: "action",
      header: "Action",
      cell: (f) => (
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {f.action.kind !== "none" && <Link href={f.action.href}>{f.action.label}</Link>}
          {canRemove && f.canRemove && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setRemoving(f);
              }}
              aria-label={`Remove ${f.fileName}`}
              className="cursor-pointer border-0 bg-transparent p-0 text-sm text-primary underline hover:text-primary-hover"
            >
              Remove
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <Card title="Files read by AI" padding="table">
        <DataTable
          label="Uploaded files"
          columns={columns}
          rows={files}
          rowKey={(f) => f.id}
          empty="No files yet. Upload a workbook or invoices above — they are listed here until imported."
        />
      </Card>
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `Remove ${removing.fileName}?` : "Remove file"}
        description="It hasn't been imported, so nothing in your records changes."
      >
        {error && (
          <p role="alert" className="mt-0 mb-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => setRemoving(null)}>
            Keep
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await removeFileAction(removing!.id);
                if (r.ok) setRemoving(null);
                else setError(r.message);
              })
            }
          >
            {pending ? "Removing…" : "Remove"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

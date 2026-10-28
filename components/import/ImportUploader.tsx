"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatFileSize, prepareUpload } from "@/lib/image-upload";
import {
  ACCEPT_ATTR,
  checkImportFile,
  formatOf,
  IMPORT_MAX_BYTES,
  isImage,
  type ImportSource,
} from "@/lib/import/file-types";

type Props = {
  /** null = allowed; otherwise why this role can't use the card ("Your role (Accountant) can't …"). */
  excelBlocked: string | null;
  documentsBlocked: string | null;
  /** Names of this company's saved mappings. */
  mappingNames: string[];
};

const linkButton =
  "min-h-control cursor-pointer border-0 bg-transparent p-0 font-semibold text-primary underline hover:text-primary-hover disabled:cursor-not-allowed disabled:opacity-50";

/** The two upload cards of Import.dc.html. Files go up one at a time to /import/upload. */
export function ImportUploader({ excelBlocked, documentsBlocked, mappingNames }: Props) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <UploadCard
        source="excel"
        title="Excel booking import"
        blocked={excelBlocked}
        intro="Booking report workbook (.xlsx / .xls / .csv, up to 10 MB). AI finds the right sheet and header row, matches columns in any order or naming, reads formula results as values."
        dropText="Drop workbook here"
        submit="Upload and validate"
        savesInto={
          <>
            Saves into: LR register · parties · trucks · freight charges · Saved mapping:{" "}
            <b>{mappingNames.length ? mappingNames.join(", ") : "none yet"}</b>
          </>
        }
      />
      <UploadCard
        source="document"
        title="Smart invoice & document import"
        blocked={documentsBlocked}
        intro="Tax invoices, LRs, PODs, e-way bills — PDF (typed or scanned), JPG / PNG photo, or invoice-format Excel. Many files at once; AI detects the document type."
        dropText="Drop PDFs, photos or .xlsx here"
        submit="Upload and read with AI"
        savesInto="Saves into: tax invoices · LRs · POD · parties · items · original file attached"
      />
    </div>
  );
}

function UploadCard({
  source,
  title,
  intro,
  dropText,
  submit,
  savesInto,
  blocked,
}: {
  source: ImportSource;
  title: string;
  intro: string;
  dropText: string;
  submit: string;
  savesInto: React.ReactNode;
  blocked: string | null;
}) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const multiple = source === "document";
  const disabled = blocked !== null || progress !== null;

  /** Name, type and size are checked straight away, so a wrong file never waits for Upload. */
  function add(list: File[]) {
    if (!list.length) return;
    const problems: string[] = [];
    const good: File[] = [];
    for (const f of list) {
      // A big photo is fine here: it is shrunk before it goes up. Everything else is held to 10 MB.
      const fmt = formatOf(f.name);
      const check = checkImportFile(
        { name: f.name, size: f.size },
        source,
        fmt && isImage(fmt) ? Infinity : IMPORT_MAX_BYTES,
      );
      if (!check.ok) problems.push(check.message);
      else good.push(f);
    }
    setErrors(problems);
    setFiles((prev) => (multiple ? [...prev, ...good] : good.slice(0, 1)));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (!disabled) add(Array.from(e.dataTransfer.files));
  }

  async function upload() {
    if (!files.length) {
      setErrors(["Choose a file first."]);
      return;
    }
    const problems: string[] = [];
    let lastBatchId: string | null = null;
    let done = 0;
    for (const [i, original] of files.entries()) {
      setProgress(`Uploading ${i + 1} of ${files.length}…`);
      // Photos are shrunk first (1800 px, JPEG 80%); PDFs and workbooks go up as they are.
      const format = formatOf(original.name);
      let file = original;
      if (format && isImage(format)) {
        const prepared = await prepareUpload(original, {
          maxBytes: IMPORT_MAX_BYTES,
          requestLimit: IMPORT_MAX_BYTES,
        });
        if (!prepared.ok) {
          problems.push(prepared.message);
          continue;
        }
        file = prepared.file;
      }
      const checked = checkImportFile({ name: file.name, size: file.size }, source);
      if (!checked.ok) {
        problems.push(checked.message);
        continue;
      }
      const body = new FormData();
      body.set("source", source);
      body.set("file", file);
      try {
        const res = await fetch("/import/upload", { method: "POST", body });
        const json = (await res.json()) as { ok: boolean; message?: string; batchId?: string };
        if (json.ok && json.batchId) {
          lastBatchId = json.batchId;
          done++;
        } else {
          // Server messages already name the file; the generic ones don't.
          const m = json.message ?? "the upload failed.";
          problems.push(m.includes(original.name) ? m : `${original.name}: ${m}`);
        }
      } catch {
        problems.push(`${original.name}: couldn't reach the server — check your connection.`);
      }
    }
    setProgress(null);
    setErrors(problems);
    setFiles([]);
    if (done > 0) {
      // Excel goes straight to its review; documents stay on the list.
      if (source === "excel" && lastBatchId) router.push(`/import?batch=${lastBatchId}`);
      else router.push("/import");
      router.refresh();
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="m-0 text-[17px] font-bold">{title}</h2>
      <p className="m-0 text-sm leading-normal text-muted">{intro}</p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`rounded-card border-2 border-dashed p-5.5 text-center text-sm leading-relaxed text-label ${
          blocked
            ? "border-border-input bg-surface-muted opacity-70"
            : over
              ? "border-primary bg-primary-soft"
              : "border-navy-muted bg-surface-subtle"
        }`}
      >
        <b className="text-base text-text">{dropText}</b>
        <br />
        <input
          ref={pick}
          type="file"
          accept={ACCEPT_ATTR[source]}
          multiple={multiple}
          className="sr-only"
          tabIndex={-1}
          aria-label={
            source === "excel" ? "Choose a booking workbook" : "Choose invoices or documents"
          }
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className={linkButton}
          disabled={disabled}
          onClick={() => pick.current?.click()}
        >
          {multiple ? "Choose files" : "Choose file"}
        </button>
        {multiple && (
          <>
            {" · "}
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-label="Take a photo of a document"
              onChange={(e) => {
                add(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={linkButton}
              disabled={disabled}
              onClick={() => camera.current?.click()}
            >
              Take photo
            </button>
          </>
        )}
        {files.length > 0 && (
          <ul className="m-0 mt-2 list-none p-0 text-[13px] text-muted">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span className="font-mono">{f.name}</span> · {formatFileSize(f.size)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {blocked && (
        <p role="note" className="m-0 text-sm text-warning">
          {blocked}
        </p>
      )}
      {errors.map((m) => (
        <p key={m} role="alert" className="m-0 text-[13px] text-danger">
          {m}
        </p>
      ))}
      {progress && (
        <p role="status" className="m-0 text-[13px] text-muted">
          {progress}
        </p>
      )}

      <div className="text-[13px] text-muted">{savesInto}</div>
      <Button onClick={upload} disabled={disabled}>
        {progress ? "Uploading…" : submit}
      </Button>
    </Card>
  );
}

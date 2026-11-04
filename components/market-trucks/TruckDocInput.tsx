"use client";

import { useState } from "react";
import { uploadTruckDocAction } from "@/app/(app)/market-trucks/parties/actions";
import { prepareUpload } from "@/lib/image-upload";

/**
 * Pick a file, shrink it if it is a photo, upload it, and report the app link back.
 * `kind` decides what the server accepts: "upi-qr" photos only; "tds", "rc", "dl" photos or PDF.
 */
export function TruckDocInput({
  label,
  kind,
  url,
  onChange,
  error,
}: {
  label: string;
  kind: "upi-qr" | "tds" | "rc" | "dl";
  url: string | null;
  onChange: (url: string | null) => void;
  error?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    setBusy(true);
    try {
      const prepared = await prepareUpload(file);
      if (!prepared.ok) return setMessage(prepared.message);
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", prepared.file);
      const result = await uploadTruckDocAction(form);
      if (result.ok) onChange(result.url);
      else setMessage(result.message);
    } finally {
      setBusy(false);
    }
  }

  const shown = message ?? error;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-text">{label}</span>
      <input
        type="file"
        accept={kind === "upi-qr" ? "image/*" : "image/*,application/pdf"}
        disabled={busy}
        onChange={(e) => void pick(e.target.files?.[0])}
        className="text-sm text-muted file:mr-3 file:h-control file:cursor-pointer file:rounded-control file:border file:border-input-border file:bg-surface file:px-3 file:text-sm file:font-semibold file:text-text"
      />
      {busy && <span className="text-[13px] text-muted">Uploading…</span>}
      {url && !busy && (
        <span className="text-[13px] text-muted">
          <a href={url} target="_blank" rel="noreferrer" className="font-semibold underline">
            View uploaded file
          </a>{" "}
          ·{" "}
          <button type="button" className="underline" onClick={() => onChange(null)}>
            Remove
          </button>
        </span>
      )}
      {shown && <span className="text-[13px] text-danger">{shown}</span>}
    </div>
  );
}

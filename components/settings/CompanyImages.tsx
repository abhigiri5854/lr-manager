"use client";

import { useRef, useState, useTransition } from "react";
import { uploadCompanyImageAction } from "@/app/(app)/settings/company/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { prepareUpload } from "@/lib/image-upload";

// WebP is accepted from the picker because it is re-encoded to JPEG/PNG before upload.
const ACCEPT = "image/png,image/svg+xml,image/jpeg,image/webp";
const STORED_TYPES = ["image/png", "image/svg+xml", "image/jpeg"];
const MAX_BYTES = 2 * 1024 * 1024;

type Images = { logoUrl: string | null; signatureUrl: string | null; useLogoWatermark: boolean };

/** Logo, watermark & signature. Files upload straight away; "Save changes" stores the links. */
export function CompanyImages({
  companyId,
  companyName,
  logoUrl,
  signatureUrl,
  useLogoWatermark,
  errors,
  onChange,
}: Images & {
  companyId: string;
  companyName: string;
  errors: Record<string, string>;
  onChange: (patch: Partial<Images>) => void;
}) {
  const [uploadError, setUploadError] = useState<{ logo?: string; signature?: string }>({});
  const [busy, setBusy] = useState<"logo" | "signature" | null>(null);
  const [, startTransition] = useTransition();
  const logoInput = useRef<HTMLInputElement>(null);
  const signatureInput = useRef<HTMLInputElement>(null);

  function upload(kind: "logo" | "signature", picked: File | undefined) {
    if (!picked) return;
    const key = kind === "logo" ? "logoUrl" : "signatureUrl";
    if (!ACCEPT.split(",").includes(picked.type)) {
      setUploadError({ [kind]: `${picked.name}: use a PNG, SVG or JPG image` });
      return;
    }
    setUploadError({});
    setBusy(kind);
    startTransition(async () => {
      // Shrunk to 1800px / JPEG 80% (transparent PNGs stay PNG); SVGs go up unchanged.
      const prepared = await prepareUpload(picked, { maxBytes: MAX_BYTES, keepTransparency: true });
      if (!prepared.ok || !STORED_TYPES.includes(prepared.file.type)) {
        setBusy(null);
        setUploadError({
          [kind]: prepared.ok ? `${picked.name}: use a PNG, SVG or JPG image` : prepared.message,
        });
        return;
      }
      const fd = new FormData();
      fd.set("companyId", companyId);
      fd.set("kind", kind);
      fd.set("file", prepared.file);
      const r = await uploadCompanyImageAction(fd);
      setBusy(null);
      if (r.ok) onChange({ [key]: r.url });
      else setUploadError({ [kind]: r.kind === "validation" ? r.issues[0].message : r.message });
    });
  }

  const logoError = uploadError.logo ?? errors.logoUrl;
  const signatureError = uploadError.signature ?? errors.signatureUrl;

  return (
    <Card title="Logo, watermark & signature">
      <div className="flex flex-wrap items-center gap-5">
        <ImageBox url={logoUrl} alt={`${companyName} logo`} empty="No logo yet" />
        <div className="flex flex-col gap-2.5 text-sm">
          <input
            ref={logoInput}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              upload("logo", e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => logoInput.current?.click()}
          >
            {busy === "logo"
              ? "Uploading…"
              : logoUrl
                ? "Replace logo (PNG / SVG)"
                : "Upload logo (PNG / SVG / JPG)"}
          </Button>
          <Checkbox
            checked={useLogoWatermark}
            onChange={(v) => onChange({ useLogoWatermark: v })}
            className="min-h-0"
          >
            Use logo as watermark on PDFs
          </Checkbox>
          {logoUrl && (
            <button
              type="button"
              className="self-start text-sm font-semibold text-primary underline"
              onClick={() => onChange({ logoUrl: null })}
            >
              Remove logo
            </button>
          )}
          {logoError && (
            <p role="alert" className="m-0 text-[13px] text-danger">
              {logoError}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-5 border-t border-border-row pt-5">
        <ImageBox url={signatureUrl} alt="Signature / stamp" empty="No signature yet" />
        <div className="flex flex-col gap-2.5 text-sm">
          <input
            ref={signatureInput}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              upload("signature", e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => signatureInput.current?.click()}
          >
            {busy === "signature" ? "Uploading…" : "Upload signature / stamp"}
          </Button>
          {signatureUrl && (
            <button
              type="button"
              className="self-start text-sm font-semibold text-primary underline"
              onClick={() => onChange({ signatureUrl: null })}
            >
              Remove signature
            </button>
          )}
          {signatureError && (
            <p role="alert" className="m-0 text-[13px] text-danger">
              {signatureError}
            </p>
          )}
          <p className="m-0 text-[13px] text-muted">PNG, SVG or JPG, up to 2 MB each.</p>
        </div>
      </div>
    </Card>
  );
}

function ImageBox({ url, alt, empty }: { url: string | null; alt: string; empty: string }) {
  return (
    <div className="box-border flex h-[110px] w-[220px] items-center justify-center rounded-tile border border-border p-3">
      {url ? (
        // Uploaded files are served from /uploads (private, per company) — not next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="max-h-full max-w-full" />
      ) : (
        <span className="text-[13px] text-muted">{empty}</span>
      )}
    </div>
  );
}

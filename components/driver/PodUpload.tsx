"use client";

import { useRef, useState } from "react";
import type { DriverTripLr } from "@/lib/types";
import { ApiError, NetworkError, uploadPod } from "@/lib/driver-app/api";
import { compressImage } from "@/lib/driver-app/compress";
import { todayIso } from "@/lib/driver-app/format";
import { useDriver } from "./DriverProvider";
import { btnOutline, btnPrimary, btnSoft, input } from "./ui";

/** POD for one LR: photo or PDF, packages delivered, delivery date. Not queued offline: failures show Retry. */
export function PodUpload({
  token,
  challanId,
  lr,
  onDone,
}: {
  token: string;
  challanId: string;
  lr: DriverTripLr;
  onDone: () => Promise<void>;
}) {
  const { t } = useDriver();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [packages, setPackages] = useState(String(lr.packages));
  const [deliveredOn, setDeliveredOn] = useState(todayIso());
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!file) {
      setError(t("chooseFile"));
      return;
    }
    setError(null);
    setProgress(0);
    try {
      const upload = await compressImage(file);
      const form = new FormData();
      form.set("file", upload);
      form.set("challanId", challanId);
      form.set("lrId", lr.lrId);
      form.set("packages", packages);
      form.set("deliveredOn", deliveredOn);
      await uploadPod(token, form, setProgress);
      setDone(true);
      setOpen(false);
      setFile(null);
      await onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof NetworkError ? t("offline") : t("loadError"));
    } finally {
      setProgress(null);
    }
  }

  if (!open) {
    return (
      <div>
        {done && <p className="mb-2 text-base font-semibold text-success">{t("podDone")}</p>}
        <button type="button" className={`${btnSoft} w-full`} onClick={() => setOpen(true)}>
          📷 {t("uploadPod")}
        </button>
      </div>
    );
  }

  const busy = progress !== null;
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-page p-3">
      <input
        ref={picker}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setError(null);
        }}
      />
      <button type="button" className={`${btnOutline} w-full`} disabled={busy} onClick={() => picker.current?.click()}>
        📷 {file ? file.name : t("takePhoto")}
      </button>

      <label className="flex flex-col gap-1 text-base font-semibold">
        {t("deliveredPkgs")}
        <input
          className={input}
          type="number"
          inputMode="numeric"
          min={0}
          value={packages}
          disabled={busy}
          onChange={(e) => setPackages(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-base font-semibold">
        {t("deliveredOn")}
        <input
          className={input}
          type="date"
          max={todayIso()}
          value={deliveredOn}
          disabled={busy}
          onChange={(e) => setDeliveredOn(e.target.value)}
        />
      </label>

      {busy && (
        <div>
          <div className="h-3 overflow-hidden rounded-full bg-primary-soft" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-center text-base">{t("uploading", { p: progress })}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-base font-semibold text-red-700">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={btnOutline} disabled={busy} onClick={() => setOpen(false)}>
          {t("cancel")}
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
          {error && file ? t("retry") : t("send")}
        </button>
      </div>
    </div>
  );
}

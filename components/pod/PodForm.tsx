"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { savePodAction, uploadPodFileAction } from "@/app/(app)/lr/[id]/pod/pod-actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DateField, focusFirstInvalidDate } from "@/components/ui/DateField";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCan, useRole } from "@/components/ui/Permissions";
import { cx } from "@/lib/cx";
import { formatDate, formatRupeesShort } from "@/lib/format";
import { deniedMessage } from "@/lib/permissions";
import { formatFileSize, prepareUpload } from "@/lib/image-upload";
import { podDueDate, podLateDays } from "@/lib/pod-rules";
import type { Paise } from "@/lib/types";
import { uploadName } from "@/lib/upload-name";
import { isValidMobile, normaliseMobile } from "@/lib/validators/common";

type Condition = "good" | "short" | "damaged";

export type PodFormProps = {
  lr: {
    id: string;
    lrNo: string;
    lrDate: string | null;
    status: string;
    consignor: string | null;
    consignee: string | null;
    truck: string | null;
    totalPackages: number;
    /** yyyy-mm-dd, or "" if not delivered yet */
    deliveredOn: string;
  };
  pod: {
    id: string;
    version: number;
    receivedBy: string;
    receiverPhone: string;
    packagesReceived: number | null;
    condition: Condition;
    remarks: string;
    documentUrls: string[];
  } | null;
  podDays: number | null;
  podPenaltyPerDay: Paise | null;
  today: string;
  /** Shown once after a save, e.g. "Delivery saved". */
  notice?: string | null;
  /** Why the POD can't be edited (e.g. the LR is cancelled); the form is shown disabled. */
  readOnlyReason?: string | null;
};

/** A file picked on this screen; `url` is set once it has been uploaded (kept on a retry). */
type NewFile = { key: string; file: File; preview: string | null; url?: string };
type ErrorKey = "deliveredOn" | "receiverPhone" | "packagesReceived" | "remarks" | "files";
type Errors = Partial<Record<ErrorKey, string>>;

const FIELD_KEYS = new Set<string>(["deliveredOn", "receiverPhone", "packagesReceived", "remarks"]);

const STATUS_NOTE: Record<string, string> = {
  Booked: "saving delivery details marks it Delivered",
  "In transit": "saving delivery details marks it Delivered",
  Delivered: "add the signed copy to mark POD received",
};

const isImage = (url: string) => /\.(jpe?g|png|webp|gif|heic)$/i.test(uploadName(url));

export function PodForm({
  lr,
  pod,
  podDays,
  podPenaltyPerDay,
  today,
  notice,
  readOnlyReason: statusReason,
}: PodFormProps) {
  const router = useRouter();
  const role = useRole();
  const canUpload = useCan("pod.upload");
  const readOnlyReason = statusReason ?? (canUpload ? null : deniedMessage(role, "pod.upload"));
  const [pending, startTransition] = useTransition();
  const [deliveredOn, setDeliveredOn] = useState(lr.deliveredOn);
  const [receivedBy, setReceivedBy] = useState(pod?.receivedBy ?? "");
  const [phone, setPhone] = useState(pod?.receiverPhone ?? "");
  const [packages, setPackages] = useState(String(pod?.packagesReceived ?? lr.totalPackages));
  const [condition, setCondition] = useState<Condition>(pod?.condition ?? "good");
  const [remarks, setRemarks] = useState(pod?.remarks ?? "");
  const [kept, setKept] = useState<string[]>(pod?.documentUrls ?? []);
  const [added, setAdded] = useState<NewFile[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(notice ?? null);
  const [preparing, setPreparing] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  // Free the blob: URLs of the previews when the form goes away.
  const addedRef = useRef(added);
  useEffect(() => {
    addedRef.current = added;
  }, [added]);
  useEffect(
    () => () => addedRef.current.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)),
    [],
  );

  const readOnly = Boolean(readOnlyReason);
  const disabled = readOnly || pending || preparing;
  const received = Number(packages) || 0;
  const shortBy = packages !== "" && lr.totalPackages > received ? lr.totalPackages - received : 0;
  const due = deliveredOn ? podDueDate(deliveredOn, podDays) : null;
  const late = deliveredOn ? podLateDays(deliveredOn, today, podDays) : 0;
  const rateKnown = podPenaltyPerDay != null && podPenaltyPerDay > 0;
  const needsRemarks = condition !== "good";

  async function addFiles(e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!list.length) return;
    const bad = list.find((f) => !(f.type.startsWith("image/") || f.type === "application/pdf"));
    if (bad) {
      setErrors((p) => ({ ...p, files: `${bad.name}: only photos and PDFs can be uploaded` }));
      return;
    }
    // Photos are shrunk here (1800px, JPEG 80%); only a file still over 3 MB is refused.
    setPreparing(true);
    const prepared = await Promise.all(list.map((f) => prepareUpload(f)));
    setPreparing(false);
    const ok = prepared.flatMap((p) => (p.ok ? [p.file] : []));
    const tooBig = prepared.flatMap((p) => (p.ok ? [] : [p.message]));
    setErrors((p) => ({ ...p, files: tooBig.length ? tooBig.join(" ") : undefined }));
    setAdded((p) => [
      ...p,
      ...ok.map((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      })),
    ]);
  }

  function removeNew(key: string) {
    const gone = added.find((f) => f.key === key);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    setAdded((p) => p.filter((f) => f.key !== key));
  }

  function validate(): Errors {
    const e: Errors = {};
    if (!deliveredOn) e.deliveredOn = "Enter the delivery date";
    else if (deliveredOn > today) e.deliveredOn = "Delivery date can't be in the future";
    else if (lr.lrDate && deliveredOn < lr.lrDate) e.deliveredOn = "Delivered before the LR date";
    if (phone.trim() && !isValidMobile(normaliseMobile(phone))) {
      e.receiverPhone = "Enter a 10-digit mobile number";
    }
    if (needsRemarks && !remarks.trim()) {
      e.remarks = `Add remarks — what was ${condition === "short" ? "short" : "damaged"}?`;
    }
    return e;
  }

  function save() {
    if (focusFirstInvalidDate()) return;
    setFormError(null);
    setConflict(null);
    setSavedNote(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      setFormError("Fix the marked fields to save.");
      return;
    }
    const fd = new FormData();
    fd.set("lrId", lr.id);
    fd.set("expectedVersion", String(pod?.version ?? ""));
    fd.set(
      "fields",
      JSON.stringify({
        deliveredOn,
        receivedBy,
        receiverPhone: phone,
        packagesReceived: packages,
        condition,
        remarks,
      }),
    );
    kept.forEach((u) => fd.append("keep", u));
    startTransition(async () => {
      // One request per new file (each under the 3 MB limit); already uploaded ones are reused.
      const urls: string[] = [];
      for (const f of added) {
        let url = f.url;
        if (!url) {
          const one = new FormData();
          one.set("file", f.file);
          const up = await uploadPodFileAction(one);
          if (!up.ok) {
            setErrors((p) => ({ ...p, files: up.message }));
            setFormError("A file couldn't be uploaded — remove it or choose a smaller one.");
            return;
          }
          url = up.url;
          const done = url;
          setAdded((p) => p.map((x) => (x.key === f.key ? { ...x, url: done } : x)));
        }
        urls.push(url);
      }
      urls.forEach((u) => fd.append("keep", u));
      const r = await savePodAction(fd);
      if (r.ok) {
        router.replace(`/lr/${lr.id}/pod?saved=${r.received ? "received" : "delivered"}`);
        return;
      }
      if (r.kind === "conflict") {
        setConflict(r.message);
      } else if (r.kind === "validation") {
        const byField: Errors = {};
        const general: string[] = [];
        for (const i of r.issues) {
          if (i.path === "documentUrls") byField.files = i.message;
          else if (FIELD_KEYS.has(i.path)) byField[i.path as ErrorKey] = i.message;
          else general.push(i.message);
        }
        setErrors(byField);
        setFormError(general.join(" ") || "Fix the marked fields to save.");
      } else {
        setFormError(r.message);
      }
    });
  }

  const note = STATUS_NOTE[lr.status];
  const subtitle = `${lr.consignor ?? "—"} → ${lr.consignee ?? "—"} · ${lr.truck ?? "no truck"} · Status: ${lr.status}${note ? ` — ${note}` : ""}`;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: `← LR ${lr.lrNo}`, href: `/lr/${lr.id}` }]}
        title={
          <>
            POD · <span className="font-mono text-primary">{lr.lrNo}</span>
          </>
        }
        subtitle={subtitle}
        actions={
          <>
            <Button variant="secondary" onClick={save} disabled={disabled}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              variant="secondary"
              href={pod ? `/pdf/pod/${pod.id}` : "#"}
              newTab
              disabled={!pod}
            >
              Preview PDF
            </Button>
            <Button variant="dark" href={pod ? `/pdf/pod/${pod.id}` : "#"} download disabled={!pod}>
              Download PDF
            </Button>
          </>
        }
      />

      {readOnlyReason && <Alert tone="warning" title={readOnlyReason} />}
      {savedNote && (
        <div
          role="status"
          className="rounded-control bg-success-soft px-4 py-3 text-sm font-semibold text-success"
        >
          {savedNote}
        </div>
      )}
      {conflict && (
        <Alert
          tone="warning"
          title="Not saved — this POD was changed by someone else since you opened it."
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload latest version
            </Button>
          }
        >
          Reloading shows their changes; anything you typed here will be lost, so note it down
          first.
        </Alert>
      )}
      {formError && !conflict && (
        <div role="alert" className="rounded-control bg-danger-soft px-4 py-3 text-sm text-danger">
          {formError}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[999_1_640px]">
          <Card title="Delivery details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DateField
                label="Delivered on"
                value={deliveredOn}
                min={lr.lrDate ?? undefined}
                max={today}
                onChange={setDeliveredOn}
                error={errors.deliveredOn}
                disabled={disabled}
                required
              />
              <Field
                label="Received by"
                placeholder="Name at consignee"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                maxLength={100}
                disabled={disabled}
              />
              <Field
                label="Receiver phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                error={errors.receiverPhone}
                disabled={disabled}
              />
              <Field
                label={`Packages received (of ${lr.totalPackages})`}
                inputMode="numeric"
                value={packages}
                onChange={(e) => setPackages(e.target.value.replace(/\D/g, ""))}
                error={errors.packagesReceived}
                hint={shortBy > 0 ? <b className="text-warning">Short by {shortBy}</b> : undefined}
                disabled={disabled}
              />
              <Select
                label="Condition"
                value={condition}
                onChange={(e) => setCondition(e.target.value as Condition)}
                disabled={disabled}
              >
                <option value="good">Good</option>
                <option value="short">Short</option>
                <option value="damaged">Damaged</option>
              </Select>
              {podDays != null && (
                <Field
                  label="POD due by"
                  value={due ? formatDate(due) : ""}
                  placeholder={`Auto: delivery + ${podDays} days`}
                  readOnly
                  hint={
                    late > 0 ? (
                      <b className="text-warning">
                        {late} day{late === 1 ? "" : "s"} late
                        {rateKnown && ` · penalty ${formatRupeesShort(late * podPenaltyPerDay!)}`}
                      </b>
                    ) : undefined
                  }
                />
              )}
              <Textarea
                label={needsRemarks ? "Remarks (required)" : "Remarks"}
                placeholder="Shortage, damage or note from consignee"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                maxLength={500}
                error={errors.remarks}
                disabled={disabled}
                className="sm:col-span-2 lg:col-span-3"
              />
            </div>

            <div
              className={cx(
                "mt-4 rounded-tile border-2 border-dashed bg-surface-subtle p-4",
                errors.files ? "border-danger" : "border-border-dashed",
              )}
            >
              <p className="m-0 text-sm font-semibold text-text-strong">
                Upload signed &amp; stamped LR copy — photo or PDF (driver can upload from phone)
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  onClick={() => camera.current?.click()}
                  disabled={disabled}
                >
                  Take photo
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => pick.current?.click()}
                  disabled={disabled}
                >
                  Choose files
                </Button>
              </div>
              <input
                ref={camera}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                tabIndex={-1}
                aria-label="Take a photo of the signed copy"
                onChange={addFiles}
              />
              <input
                ref={pick}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-label="Choose signed copy photos or PDFs"
                onChange={addFiles}
              />
              {preparing && (
                <div role="status" className="mt-2 text-[13px] text-muted">
                  Preparing photos…
                </div>
              )}
              {errors.files && (
                <div role="alert" className="mt-2 text-[13px] text-danger">
                  {errors.files}
                </div>
              )}
              {(kept.length > 0 || added.length > 0) && (
                <ul className="m-0 mt-3 flex list-none flex-wrap gap-3 p-0">
                  {kept.map((url) => (
                    <FileTile
                      key={url}
                      name={uploadName(url)}
                      src={isImage(url) ? url : null}
                      href={url}
                      onRemove={
                        disabled ? undefined : () => setKept((p) => p.filter((u) => u !== url))
                      }
                    />
                  ))}
                  {added.map((f) => (
                    <FileTile
                      key={f.key}
                      name={f.file.name}
                      size={f.file.size}
                      src={f.preview}
                      isNew
                      onRemove={disabled ? undefined : () => removeNew(f.key)}
                    />
                  ))}
                </ul>
              )}
              {added.length > 0 && (
                <p className="m-0 mt-2 text-[13px] text-muted">
                  {added.length} new file{added.length === 1 ? "" : "s"} — uploaded when you save.
                </p>
              )}
            </div>

            {podDays != null && (
              <p className="m-0 mt-4 text-[13px] text-warning">
                POD late after {podDays} days of delivery
                {rateKnown
                  ? ` → ${formatRupeesShort(podPenaltyPerDay!)}/day penalty is calculated automatically.`
                  : "."}
              </p>
            )}
          </Card>
        </div>

        <aside className="min-w-0 flex-[1_1_300px]">
          <Card title="Documents">
            <p className="m-0 text-sm text-muted">
              LR, goods invoice, POD and freight bill PDFs for this shipment are all on the LR{" "}
              {lr.lrNo} page.
            </p>
            <p className="m-0 mt-3 text-sm">
              <Link href={`/lr/${lr.id}`}>Open LR {lr.lrNo} →</Link>
            </p>
          </Card>
        </aside>
      </div>

      {/* Phones: the Save button stays in reach of the thumb. */}
      <div className="sticky bottom-0 border-t border-border bg-surface p-3 sm:hidden">
        <Button className="w-full" variant="dark" onClick={save} disabled={disabled}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </>
  );
}

function FileTile({
  name,
  src,
  href,
  size,
  isNew,
  onRemove,
}: {
  name: string;
  src: string | null;
  href?: string;
  /** Size after compression, for new files. */
  size?: number;
  isNew?: boolean;
  onRemove?: () => void;
}) {
  const thumb = src ? (
    // eslint-disable-next-line @next/next/no-img-element -- blob: previews and private uploads
    <img src={src} alt={name} className="h-20 w-20 rounded-control object-cover" />
  ) : (
    <span className="flex h-20 w-20 items-center justify-center rounded-control bg-surface-muted text-xs font-semibold text-muted">
      PDF
    </span>
  );
  return (
    <li className="relative w-24 text-center">
      {href ? (
        <a href={href} target="_blank" rel="noopener" className="inline-block">
          {thumb}
        </a>
      ) : (
        thumb
      )}
      <div className="mt-1 truncate text-xs text-muted" title={name}>
        {isNew && <b className="text-primary">New · </b>}
        {name}
        {size !== undefined && <div>{formatFileSize(size)}</div>}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="absolute -top-2 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-border-input bg-surface text-sm font-bold text-text"
        >
          ×
        </button>
      )}
    </li>
  );
}

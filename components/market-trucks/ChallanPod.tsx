"use client";

// "POD & settlement" section of the challan page (TIER1-MARKET-TRUCKS.md §6 screen 3).
// Dates + delivered packages + POD files → recordChallanPod; POD charges and the late-POD override →
// saveChallanPodCharges; Settle / Reopen. Payments are optional and never required to settle.
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { uploadPodFileAction } from "@/app/(app)/lr/[id]/pod/pod-actions";
import {
  recordChallanPodAction,
  reopenChallanAction,
  saveChallanPodChargesAction,
  settleChallanAction,
} from "@/app/(app)/market-trucks/challans/actions";
import type { ActionFailure } from "@/app/(app)/market-trucks/failure";
import { FileTile, isImage } from "@/components/pod/PodForm";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { DateField, focusFirstInvalidDate } from "@/components/ui/DateField";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { formatPaise } from "@/lib/format";
import { toPaise } from "@/lib/hire";
import { prepareUpload } from "@/lib/image-upload";
import type {
  ChallanPodCharge,
  ChallanSettlement,
  ChallanStatus,
  ChargeDirection,
  ChargeType,
} from "@/lib/types";
import { uploadName } from "@/lib/upload-name";
import type { ChallanPodChargesInput } from "@/lib/validators/challan-pod";

const STATUS_TONE: Record<ChallanStatus, ChipTone> = {
  draft: "amber",
  dispatched: "blue",
  in_transit: "blue",
  reached: "blue",
  pod_received: "green",
  settled: "grey",
};

type NewFile = { key: string; file: File; preview: string | null; url?: string };
type LineState = { delivered: string; kept: string[]; added: NewFile[]; touched: boolean };
type ChargeDraft = {
  id?: string;
  chargeTypeId: string;
  lrId: string;
  direction: ChargeDirection;
  amount: string;
  partyAmount: string;
  note: string;
};

/** ISO instant → India calendar date (yyyy-mm-dd), "" when empty. */
const istDate = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : "";
const datesOf = (s: ChallanSettlement) => ({
  reportedAt: istDate(s.reportedAt),
  unloadedAt: istDate(s.unloadedAt),
  podReceivedAt: istDate(s.podReceivedAt),
});
const linesOf = (s: ChallanSettlement): Record<string, LineState> =>
  Object.fromEntries(
    s.lines.map((l) => [
      l.lrId,
      {
        delivered: l.deliveredPkgs === null ? "" : String(l.deliveredPkgs),
        kept: l.podDocumentUrls,
        added: [],
        touched: false,
      },
    ]),
  );
const rupees = (v: string) => `₹${formatPaise(toPaise(v))}`;

export function ChallanPod({
  initial,
  chargeTypes,
  canPod,
  canBill,
  canCancel,
}: {
  initial: ChallanSettlement;
  /** POD-stage charge types (active ones, plus any a saved line uses). */
  chargeTypes: ChargeType[];
  /** pod.upload */
  canPod: boolean;
  /** bill.edit */
  canBill: boolean;
  /** record.cancel */
  canCancel: boolean;
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [dates, setDates] = useState(() => datesOf(initial));
  const [lines, setLines] = useState(() => linesOf(initial));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<ChargeDraft | null>(null);
  const [override, setOverride] = useState<{ amount: string; reason: string } | null>(null);
  const [settling, setSettling] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [preparing, setPreparing] = useState(false);
  const pickers = useRef<Record<string, HTMLInputElement | null>>({});

  const settled = s.status === "settled";
  const isDraft = s.status === "draft";
  const podLocked = settled || isDraft || !canPod;
  const chargeLocked = settled || isDraft || !canBill;
  const busy = pending || preparing;

  const latePod = s.charges.find((c) => c.autoKind === "late_pod");
  const shortages = s.charges.filter((c) => c.autoKind === "shortage");
  const manual = s.charges.filter((c) => c.autoKind === null);
  const latePodOverridden = !!latePod && latePod.autoAmount !== null && latePod.amount !== latePod.autoAmount;
  const typeById = new Map(chargeTypes.map((t) => [t.id, t]));
  const shortLines = s.lines.filter((l) => l.deliveredPkgs !== null && l.deliveredPkgs < l.loadedPkgs);

  function fail(r: ActionFailure) {
    if (r.kind === "conflict") setConflict(true);
    setError(r.message);
  }
  const reset = () => {
    setError(null);
    setNotice(null);
    setFileError(null);
  };

  function setLine(lrId: string, patch: Partial<LineState>) {
    setLines((p) => ({ ...p, [lrId]: { ...p[lrId], ...patch } }));
  }

  async function addFiles(lrId: string, e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!list.length) return;
    const bad = list.find((f) => !(f.type.startsWith("image/") || f.type === "application/pdf"));
    if (bad) return setFileError(`${bad.name}: only photos and PDFs can be uploaded`);
    setPreparing(true);
    const prepared = await Promise.all(list.map((f) => prepareUpload(f)));
    setPreparing(false);
    const tooBig = prepared.flatMap((p) => (p.ok ? [] : [p.message]));
    setFileError(tooBig.length ? tooBig.join(" ") : null);
    const add = prepared.flatMap((p) => (p.ok ? [p.file] : [])).map((file) => ({
      key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setLines((p) => ({
      ...p,
      [lrId]: { ...p[lrId], touched: true, added: [...p[lrId].added, ...add] },
    }));
  }

  function removeNew(lrId: string, key: string) {
    const gone = lines[lrId].added.find((f) => f.key === key);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    setLine(lrId, { touched: true, added: lines[lrId].added.filter((f) => f.key !== key) });
  }

  function savePod() {
    if (focusFirstInvalidDate()) return;
    reset();
    startTransition(async () => {
      const lrs = [];
      for (const l of s.lines) {
        const st = lines[l.lrId];
        let documentUrls: string[] | undefined;
        if (st.touched) {
          documentUrls = [...st.kept];
          for (const f of st.added) {
            let url = f.url;
            if (!url) {
              const fd = new FormData();
              fd.set("file", f.file);
              fd.set("lrId", l.lrId);
              const up = await uploadPodFileAction(fd);
              if (!up.ok) {
                setFileError(`LR ${l.lrNo}: ${up.message}`);
                setError("A file couldn't be uploaded — remove it or choose a smaller one.");
                return;
              }
              url = up.url;
              const done = url;
              setLines((p) => ({
                ...p,
                [l.lrId]: {
                  ...p[l.lrId],
                  added: p[l.lrId].added.map((x) => (x.key === f.key ? { ...x, url: done } : x)),
                },
              }));
            }
            documentUrls.push(url);
          }
        }
        lrs.push({
          lrId: l.lrId,
          deliveredPkgs: st.delivered === "" ? null : Number(st.delivered),
          ...(documentUrls ? { documentUrls } : {}),
        });
      }
      const r = await recordChallanPodAction(s.id, s.version, { ...dates, lrs });
      if (!r.ok) return fail(r);
      Object.values(lines).forEach((st) => st.added.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)));
      setS(r.settlement);
      setDates(datesOf(r.settlement));
      setLines(linesOf(r.settlement));
      setNotice("POD saved.");
      router.refresh();
    });
  }

  function saveCharges(input: ChallanPodChargesInput, done: string) {
    reset();
    startTransition(async () => {
      const r = await saveChallanPodChargesAction(s.id, s.version, input);
      if (!r.ok) return fail(r);
      setS(r.settlement);
      setDraft(null);
      setOverride(null);
      setNotice(done);
    });
  }

  function submitDraft() {
    if (!draft) return;
    if (!draft.chargeTypeId) return setError("Choose a charge type.");
    saveCharges(
      {
        charges: [
          {
            id: draft.id,
            chargeTypeId: draft.chargeTypeId,
            lrId: draft.lrId,
            direction: draft.direction,
            amount: draft.amount.trim() || "0",
            partyAmount: draft.partyAmount.trim(),
            note: draft.note.trim(),
          },
        ],
      },
      draft.id ? "Charge updated." : "Charge added.",
    );
  }

  function openDraft(c?: ChallanPodCharge) {
    reset();
    setOverride(null);
    setDraft(
      c
        ? {
            id: c.id,
            chargeTypeId: c.chargeTypeId ?? "",
            lrId: c.lrId ?? "",
            direction: c.direction,
            amount: c.amount,
            partyAmount: c.partyAmount ?? "",
            note: c.note ?? "",
          }
        : {
            chargeTypeId: "",
            lrId: s.lines.length === 1 ? s.lines[0].lrId : "",
            direction: "add",
            amount: "",
            partyAmount: "",
            note: "",
          },
    );
  }

  function settle() {
    setSettling(false);
    reset();
    startTransition(async () => {
      const r = await settleChallanAction(s.id, s.version);
      if (!r.ok) return fail(r);
      setS((p) => ({ ...p, ...r.state }));
      setNotice("Challan settled.");
      router.refresh();
    });
  }

  function reopen() {
    reset();
    startTransition(async () => {
      const r = await reopenChallanAction(s.id, s.version, { reason: reopenReason });
      if (!r.ok) return fail(r);
      setReopening(false);
      setReopenReason("");
      setS((p) => ({ ...p, ...r.state }));
      setNotice("Challan reopened.");
      router.refresh();
    });
  }

  const m = s.money;
  const nonZero = (v: string) => toPaise(v) !== 0;

  return (
    <div id="pod" className="mt-5 scroll-mt-4">
      <Card
        title="POD & settlement"
        description="Record unloading and the signed POD, add POD charges, then settle. Payments are optional."
        action={
          canBill && s.status === "pod_received" ? (
            <Button onClick={() => setSettling(true)} disabled={busy}>
              Settle
            </Button>
          ) : settled && canCancel ? (
            <Button variant="secondary" onClick={() => setReopening(true)} disabled={busy}>
              Reopen
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm text-muted">
            Status: <Chip tone={STATUS_TONE[s.status]}>{s.status.replace("_", " ")}</Chip>
          </div>
          {isDraft && <Alert tone="warning" title="Dispatch the challan before recording the POD." />}
          {settled && (
            <Alert tone="warning" title="Settled — POD details and charges are locked.">
              {s.settledAt ? `Settled on ${istDate(s.settledAt).split("-").reverse().join("-")}. ` : ""}
              {canCancel ? "Reopen it (with a reason) to change them." : "Only a user who can cancel records can reopen it."}
            </Alert>
          )}
          {!settled && s.reopenReason && (
            <Alert tone="warning" title={`Reopened: ${s.reopenReason}`} />
          )}
          {!isDraft && !settled && !canPod && (
            <Alert tone="warning" title="Your role can't record the POD." />
          )}
          {conflict && (
            <Alert
              tone="warning"
              title="Not saved — this challan was changed by someone else since you opened it."
              action={
                <Button variant="secondary" onClick={() => window.location.reload()}>
                  Reload latest version
                </Button>
              }
            />
          )}
          {error && !conflict && (
            <div role="alert" className="rounded-control bg-danger-soft px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="rounded-control bg-success-soft px-4 py-3 text-sm font-semibold text-success">
              {notice}
            </div>
          )}

          {/* 1. Dates, delivered packages, POD files */}
          <section aria-label="POD details" className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <DateField
                label="Reported at destination"
                value={dates.reportedAt}
                onChange={(v) => setDates((d) => ({ ...d, reportedAt: v }))}
                disabled={podLocked || busy}
              />
              <DateField
                label="Unloaded on"
                value={dates.unloadedAt}
                onChange={(v) => setDates((d) => ({ ...d, unloadedAt: v }))}
                disabled={podLocked || busy}
              />
              <DateField
                label="POD received on"
                value={dates.podReceivedAt}
                onChange={(v) => setDates((d) => ({ ...d, podReceivedAt: v }))}
                disabled={podLocked || busy}
              />
            </div>
            {s.rules.latePodDays !== null && (
              <p className="m-0 text-[13px] text-warning">
                POD is late after {s.rules.latePodDays} days
                {s.rules.latePodFee ? ` → ${rupees(s.rules.latePodFee)} fee is worked out automatically.` : "."}
              </p>
            )}

            {s.lines.map((l) => {
              const st = lines[l.lrId];
              const short = l.loadedPkgs - (st.delivered === "" ? l.loadedPkgs : Number(st.delivered));
              return (
                <div key={l.lrId} className="rounded-tile border border-border p-3">
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="min-w-24 text-sm">
                      <div className="text-[13px] text-muted">LR</div>
                      <b className="font-mono">{l.lrNo}</b>
                    </div>
                    <div className="min-w-24 text-sm">
                      <div className="text-[13px] text-muted">Loaded pkgs</div>
                      <b>{l.loadedPkgs}</b>
                    </div>
                    <Field
                      label="Delivered pkgs"
                      inputMode="numeric"
                      value={st.delivered}
                      onChange={(e) => setLine(l.lrId, { delivered: e.target.value.replace(/\D/g, "") })}
                      disabled={podLocked || busy}
                      className="w-32"
                    />
                    {short > 0 && <b className="pb-3 text-[13px] text-warning">Short by {short}</b>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {!podLocked && (
                      <>
                        <Button variant="secondary" onClick={() => pickers.current[`${l.lrId}:cam`]?.click()} disabled={busy}>
                          Take photo
                        </Button>
                        <Button variant="secondary" onClick={() => pickers.current[`${l.lrId}:file`]?.click()} disabled={busy}>
                          Upload POD
                        </Button>
                        <input
                          ref={(el) => {
                            pickers.current[`${l.lrId}:cam`] = el;
                          }}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="sr-only"
                          tabIndex={-1}
                          aria-label={`Take a photo of the signed copy for LR ${l.lrNo}`}
                          onChange={(e) => addFiles(l.lrId, e)}
                        />
                        <input
                          ref={(el) => {
                            pickers.current[`${l.lrId}:file`] = el;
                          }}
                          type="file"
                          accept="image/*,application/pdf"
                          multiple
                          className="sr-only"
                          tabIndex={-1}
                          aria-label={`Choose signed copy files for LR ${l.lrNo}`}
                          onChange={(e) => addFiles(l.lrId, e)}
                        />
                      </>
                    )}
                    {st.kept.length === 0 && st.added.length === 0 && (
                      <span className="text-[13px] text-muted">No POD file yet.</span>
                    )}
                  </div>
                  {(st.kept.length > 0 || st.added.length > 0) && (
                    <ul className="m-0 mt-3 flex list-none flex-wrap gap-3 p-0">
                      {st.kept.map((url) => (
                        <FileTile
                          key={url}
                          name={uploadName(url)}
                          src={isImage(url) ? url : null}
                          href={url}
                          onRemove={
                            podLocked || busy
                              ? undefined
                              : () => setLine(l.lrId, { touched: true, kept: st.kept.filter((u) => u !== url) })
                          }
                        />
                      ))}
                      {st.added.map((f) => (
                        <FileTile
                          key={f.key}
                          name={f.file.name}
                          size={f.file.size}
                          src={f.preview}
                          isNew
                          onRemove={podLocked || busy ? undefined : () => removeNew(l.lrId, f.key)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {fileError && (
              <div role="alert" className="text-[13px] text-danger">
                {fileError}
              </div>
            )}
            {shortLines.length > 0 && (
              <Alert
                tone="warning"
                title={`Short delivery: ${shortLines
                  .map((l) => `LR ${l.lrNo} (${l.loadedPkgs - (l.deliveredPkgs ?? 0)} pkgs)`)
                  .join(", ")}`}
              />
            )}
            {!podLocked && (
              <div>
                <Button onClick={savePod} disabled={busy}>
                  {pending ? "Saving…" : preparing ? "Preparing photos…" : "Save POD"}
                </Button>
              </div>
            )}
          </section>

          {/* 2. Late-POD fee + shortage */}
          {(latePod || shortages.length > 0) && (
            <section aria-label="Automatic deductions" className="flex flex-col gap-3 border-t border-border pt-4">
              {latePod && (
                <div className="text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <b>{latePod.label ?? "Late POD fee"}</b>{" "}
                      <span className="text-muted">
                        · deducted from truck · auto {latePod.autoAmount !== null ? rupees(latePod.autoAmount) : "—"}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3">
                      <b>{rupees(latePod.amount)}</b>
                      {latePodOverridden && <Chip tone="amber">Overridden</Chip>}
                      {!chargeLocked && !latePod.billed && !override && (
                        <>
                          <Button
                            variant="secondary"
                            className="px-3"
                            onClick={() => {
                              reset();
                              setDraft(null);
                              setOverride({ amount: latePod.amount, reason: latePod.overrideReason ?? "" });
                            }}
                            disabled={busy}
                          >
                            Override
                          </Button>
                          {latePodOverridden && (
                            <Button
                              variant="secondary"
                              className="px-3"
                              onClick={() => saveCharges({ latePodOverride: null }, "Back to the automatic fee.")}
                              disabled={busy}
                            >
                              Clear override
                            </Button>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                  {latePodOverridden && latePod.overrideReason && (
                    <p className="m-0 mt-1 text-[13px] text-muted">Reason: {latePod.overrideReason}</p>
                  )}
                  {override && (
                    <div className="mt-3 grid grid-cols-1 items-end gap-3 sm:grid-cols-[10rem_1fr_auto]">
                      <Field
                        label="Fee (₹)"
                        inputMode="decimal"
                        value={override.amount}
                        onChange={(e) => setOverride({ ...override, amount: e.target.value })}
                      />
                      <Field
                        label="Reason"
                        value={override.reason}
                        onChange={(e) => setOverride({ ...override, reason: e.target.value })}
                        maxLength={300}
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() =>
                            saveCharges(
                              { latePodOverride: { amount: override.amount.trim(), reason: override.reason } },
                              "Late-POD fee overridden.",
                            )
                          }
                          disabled={busy}
                        >
                          Save
                        </Button>
                        <Button variant="secondary" onClick={() => setOverride(null)} disabled={busy}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {shortages.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span>
                    <b>{c.label ?? "Shortage"}</b>
                    {c.lrNo && <span className="text-muted"> · LR {c.lrNo}</span>}
                    <span className="text-muted"> · automatic</span>
                  </span>
                  <b>
                    {c.direction === "deduct" ? "−" : "+"}
                    {rupees(c.amount)}
                  </b>
                </div>
              ))}
              {shortages.length > 0 && (
                <Alert tone="warning" title="Shortage is worked out from the delivered packages and can't be edited here." />
              )}
            </section>
          )}

          {/* 3. POD charges */}
          <section aria-label="POD charges" className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="m-0 text-sm font-semibold text-text-strong">POD charges</h3>
              {!chargeLocked && !draft && (
                <Button variant="secondary" onClick={() => openDraft()} disabled={busy}>
                  + Add charge
                </Button>
              )}
            </div>
            {manual.length === 0 && !draft && (
              <p className="m-0 text-sm text-muted">No POD charges (detention, unloading…) on this challan.</p>
            )}
            {manual.length > 0 && (
              <ul className="m-0 list-none p-0">
                {manual.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2.5 text-sm last:border-0"
                  >
                    <span>
                      <b>{c.label ?? "Charge"}</b>
                      {c.lrNo && <span className="text-muted"> · LR {c.lrNo}</span>}
                      {c.note && <span className="text-muted"> · {c.note}</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-3">
                      <span>
                        {c.direction === "deduct" ? "Deduct" : "Add"} <b>{rupees(c.amount)}</b>
                      </span>
                      {c.partyAmount !== null && nonZero(c.partyAmount) && (
                        <span className="text-muted">Party {rupees(c.partyAmount)}</span>
                      )}
                      {c.billed && (
                        <Chip tone="blue">Billed{c.billedBillNo ? ` · ${c.billedBillNo}` : " · draft bill"}</Chip>
                      )}
                      {!chargeLocked && !c.billed && (
                        <>
                          <Button variant="secondary" className="px-3" onClick={() => openDraft(c)} disabled={busy}>
                            Edit
                          </Button>
                          {canCancel && (
                            <Button
                              variant="secondary"
                              className="px-3"
                              onClick={() => saveCharges({ remove: [c.id] }, "Charge removed.")}
                              disabled={busy}
                            >
                              Remove
                            </Button>
                          )}
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {draft && (
              <div className="rounded-tile border border-border p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Select
                    label="Charge type"
                    value={draft.chargeTypeId}
                    onChange={(e) => {
                      const t = typeById.get(e.target.value);
                      setDraft({
                        ...draft,
                        chargeTypeId: e.target.value,
                        direction: draft.id || !t ? draft.direction : t.defaultDirection,
                      });
                    }}
                  >
                    <option value="">Select…</option>
                    {chargeTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                  <Select label="LR" value={draft.lrId} onChange={(e) => setDraft({ ...draft, lrId: e.target.value })}>
                    <option value="">{s.lines.length > 1 ? "Select LR…" : "—"}</option>
                    {s.lines.map((l) => (
                      <option key={l.lrId} value={l.lrId}>
                        {l.lrNo}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Truck amount"
                    value={draft.direction}
                    onChange={(e) => setDraft({ ...draft, direction: e.target.value as ChargeDirection })}
                  >
                    <option value="add">Add to truck payable</option>
                    <option value="deduct">Deduct from truck payable</option>
                  </Select>
                  <Field
                    label="Truck amount (₹)"
                    inputMode="decimal"
                    value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                    placeholder="0.00"
                  />
                  <Field
                    label="Party amount (₹, optional)"
                    inputMode="decimal"
                    value={draft.partyAmount}
                    onChange={(e) => setDraft({ ...draft, partyAmount: e.target.value })}
                    hint="Leave blank to not bill the party."
                  />
                  <Field
                    label="Note"
                    value={draft.note}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                    maxLength={300}
                  />
                </div>
                {draft.partyAmount.trim() && !draft.lrId && s.lines.length > 1 && (
                  <p className="m-0 mt-2 text-[13px] text-warning">Choose the LR this party charge belongs to.</p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button onClick={submitDraft} disabled={busy}>
                    {pending ? "Saving…" : draft.id ? "Save charge" : "Add charge"}
                  </Button>
                  <Button variant="secondary" onClick={() => setDraft(null)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* 4. Money summary */}
          <section aria-label="Money summary" className="border-t border-border pt-4">
            <dl className="m-0 w-full max-w-96 text-sm">
              <SummaryRow label="Hire" value={rupees(m.hireAmount)} />
              <SummaryRow label="+ Additions" value={rupees(m.additions)} />
              <SummaryRow label="− Deductions" value={rupees(m.deductions)} />
              <SummaryRow label="− TDS" value={rupees(m.tds)} />
              <SummaryRow label="− Paid" value={rupees(m.paid)} hint="Optional — settling doesn't need a payment." />
              <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2 text-[18px] font-bold">
                <dt>= Balance</dt>
                <dd className="m-0">{rupees(m.balance)}</dd>
              </div>
            </dl>
          </section>
        </div>
      </Card>

      <Dialog
        open={settling}
        onClose={() => setSettling(false)}
        title="Settle this challan?"
        description="POD details and charges lock. Any balance stays on the challan; no payment is needed. A user who can cancel records can reopen it later."
      >
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setSettling(false)}>
            Not yet
          </Button>
          <Button variant="dark" onClick={settle} disabled={busy}>
            Settle
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={reopening}
        onClose={() => setReopening(false)}
        title="Reopen this challan?"
        description="It goes back to POD received and the POD inputs unlock. The reason is kept on the challan."
      >
        <Textarea
          label="Reason (required)"
          value={reopenReason}
          onChange={(e) => setReopenReason(e.target.value)}
          maxLength={300}
        />
        {error && !conflict && <p className="m-0 mt-2 text-[13px] text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setReopening(false)}>
            Keep settled
          </Button>
          <Button variant="dark" onClick={reopen} disabled={busy || reopenReason.trim().length < 3}>
            Reopen
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function SummaryRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted">{label}</dt>
        <dd className="m-0">{value}</dd>
      </div>
      {hint && <p className="m-0 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

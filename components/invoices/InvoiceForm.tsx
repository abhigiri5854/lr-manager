"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  cancelInvoiceAction,
  finaliseInvoiceAction,
  saveImportedInvoiceAction,
  saveInvoiceAction,
} from "@/app/(app)/invoices/actions";
import { PartyPicker } from "@/components/lr/PartyPicker";
import { TruckPicker } from "@/components/lr/TruckPicker";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { DateField, focusFirstInvalidDate } from "@/components/ui/DateField";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCan } from "@/components/ui/Permissions";
import { cx } from "@/lib/cx";
import { isPending, type ImportFlag, type PendingRecords } from "@/lib/import/invoice-prefill";
import { uploadName } from "@/lib/upload-name";
import { formatDate, formatRupees } from "@/lib/format";
import { EWAY_BILL_THRESHOLD_PAISE, GST_STATES, stateLabel } from "@/lib/gst";
import {
  formToInvoiceInput,
  INCOTERMS,
  liveTotals,
  needsStateChoice,
  shipParty,
  type InvoiceFormErrors,
  type InvoiceFormValues,
} from "@/lib/invoice-form";
import type { InvoiceLineTax } from "@/lib/tax";
import type { TaxInvoiceStatus, TaxInvoiceTotals } from "@/lib/types";
import { InvoiceItemsTable } from "./InvoiceItemsTable";
import { InvoiceStatusChip } from "./InvoiceStatusChip";

export type InvoiceMeta = {
  id: string;
  version: number;
  status: TaxInvoiceStatus;
  invoiceNo: string | null;
  cancelReason: string | null;
  sourceFileUrl: string | null;
  importBatchId: string | null;
  ewayBillNo: string | null;
  /** Saved line taxes and totals (shown as-is once locked). */
  lines: InvoiceLineTax[];
  totals: TaxInvoiceTotals;
  intraState: boolean;
};

/** Smart import: an invoice read from a file, opened here to be checked and saved. */
export type ImportInfo = {
  batchId: string;
  fileName: string;
  fileUrl: string | null;
  /** Form field path -> why it is orange. */
  flags: Record<string, ImportFlag>;
  /** Parties and a truck that are new on this invoice; created when the user saves. */
  pending: PendingRecords;
  /** An invoice with the same number from the same seller is already in the system. */
  existing: {
    id: string;
    version: number;
    status: "draft" | "final" | "cancelled";
    invoiceNo: string | null;
  } | null;
};

const FLAG_NOTE: Record<ImportFlag, string> = {
  "low-confidence": "Not sure about this one — please check it",
  "new-record": "New — saved when you save the invoice",
};

export type LinkedLr = { id: string; lrNo: string; status: string; lrDate: string | null };

const section = "rounded-card border border-border bg-surface p-5";
const h2 = "m-0 mb-4 text-[17px] font-bold";
const tile =
  "block rounded-control border border-border p-3 text-text no-underline hover:text-text";

/**
 * New / edit tax invoice (Invoice.dc.html). Seller is this company, or the consignor for an
 * imported invoice. Drafts can be edited; Finalise locks them and allocates the number.
 */
export function InvoiceForm({
  invoice,
  initial,
  seller,
  imported,
  roundOff,
  nextInvoiceNo,
  linkedLrs,
  importInfo = null,
}: {
  importInfo?: ImportInfo | null;
  invoice: InvoiceMeta | null;
  initial: InvoiceFormValues;
  seller: { name: string; gstin: string | null; state: string | null; partyId: string | null };
  imported: boolean;
  roundOff: boolean;
  /** What Finalise would allocate today (own invoices). */
  nextInvoiceNo: string | null;
  linkedLrs: LinkedLr[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<InvoiceFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const canCancel = useCan("record.cancel");
  const canEditLrs = useCan("lr.edit");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const topRef = useRef<HTMLDivElement>(null);
  const [initialJson] = useState(() => JSON.stringify(initial));

  const status: TaxInvoiceStatus = invoice?.status ?? "draft";
  const locked = status !== "draft";
  // Imported drafts open read-only until "Correct".
  const readOnly = locked || (imported && !!invoice && !correcting);
  const dirty = JSON.stringify(values) !== initialJson;

  const live = useMemo(
    () => liveTotals(values, seller.state, roundOff && !imported),
    [values, seller.state, roundOff, imported],
  );
  const shown =
    locked && invoice
      ? { lines: invoice.lines, totals: invoice.totals, intraState: invoice.intraState }
      : live;

  const set = <K extends keyof InvoiceFormValues>(key: K, value: InvoiceFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  /** Orange border + note for a field the reader wasn't sure about (Smart import). */
  const flag = (path: string) => {
    const f = importInfo?.flags[path];
    return f ? { aiFlag: f, aiNote: FLAG_NOTE[f] } : {};
  };
  const text = (key: keyof InvoiceFormValues) => ({
    value: values[key] as string,
    onChange: (e: { target: { value: string } }) => set(key, e.target.value as never),
    disabled: readOnly,
    error: errors[key === "driverMobile" ? "driverMobile" : key],
    ...flag(key),
  });

  function showErrors(e: InvoiceFormErrors, message?: string) {
    setErrors(e);
    setFormError(message ?? (Object.keys(e).length ? "Check the highlighted fields." : null));
    topRef.current?.scrollIntoView({ block: "start" });
  }

  /** Saves the draft if needed; resolves to the saved id + version, or null on failure. */
  async function saveIfNeeded(): Promise<{ id: string; version: number } | null> {
    if (invoice && (readOnly || !dirty)) return { id: invoice.id, version: invoice.version };
    if (focusFirstInvalidDate()) return null;
    const built = formToInvoiceInput(values, { imported, sellerPartyId: seller.partyId });
    if (!built.ok) {
      showErrors(built.errors);
      return null;
    }
    if (importInfo?.existing && importInfo.existing.status !== "draft") {
      showErrors(
        {},
        `${importInfo.existing.invoiceNo} is already in the system (${importInfo.existing.status}), so it can't be saved again.`,
      );
      return null;
    }
    const r = importInfo
      ? await saveImportedInvoiceAction({
          batchId: importInfo.batchId,
          input: built.input,
          pending: importInfo.pending,
          update: importInfo.existing
            ? { id: importInfo.existing.id, expectedVersion: importInfo.existing.version }
            : null,
        })
      : await saveInvoiceAction({
          id: invoice?.id,
          expectedVersion: invoice?.version,
          input: built.input,
        });
    if (r.ok) {
      setErrors({});
      setFormError(null);
      return { id: r.id, version: r.version };
    }
    if (r.kind === "conflict") setConflict(true);
    else if (r.kind === "validation") {
      showErrors(
        Object.fromEntries(r.issues.filter((i) => i.path).map((i) => [i.path, i.message])),
        r.message,
      );
    } else showErrors({}, r.message);
    return null;
  }

  function saveDraft() {
    startTransition(async () => {
      const saved = await saveIfNeeded();
      if (saved && !invoice) router.replace(`/invoices/${saved.id}`);
    });
  }

  function finalise() {
    setConfirmFinal(false);
    startTransition(async () => {
      const saved = await saveIfNeeded();
      if (!saved) return;
      const r = await finaliseInvoiceAction(saved.id, saved.version);
      if (!r.ok) {
        if (r.kind === "conflict") setConflict(true);
        else showErrors({}, r.message);
        if (!invoice) router.replace(`/invoices/${saved.id}`);
        return;
      }
      if (!invoice) router.replace(`/invoices/${saved.id}`);
    });
  }

  function createLr() {
    startTransition(async () => {
      const saved = await saveIfNeeded();
      if (saved) router.push(`/lr/new?invoice=${encodeURIComponent(saved.id)}`);
    });
  }

  function cancelInvoice() {
    if (!invoice) return;
    startTransition(async () => {
      const r = await cancelInvoiceAction(invoice.id, cancelReason);
      if (r.ok) {
        setCancelling(false);
        return;
      }
      setCancelError(r.message);
    });
  }

  const ship = shipParty(values);
  const pos = live.placeOfSupply;
  const total = shown.totals.totalPaise;
  const invoiceNo = invoice?.invoiceNo ?? null;
  const canCreateLr =
    canEditLrs && status !== "cancelled" && (!!invoiceNo || (imported && !readOnly));

  const actions = (
    <div className="flex flex-wrap gap-3">
      {!readOnly && (
        <Button variant="secondary" onClick={saveDraft} disabled={pending}>
          {pending ? "Saving…" : invoice ? "Save changes" : "Save draft"}
        </Button>
      )}
      {imported && invoice && status === "draft" && !correcting && (
        <Button variant="secondary" onClick={() => setCorrecting(true)}>
          Correct
        </Button>
      )}
      {invoice && (
        <Button variant="secondary" href={`/pdf/invoice/${invoice.id}`} newTab>
          Preview PDF
        </Button>
      )}
      {status === "draft" && (
        <Button variant="dark" onClick={() => setConfirmFinal(true)} disabled={pending}>
          Finalise
        </Button>
      )}
      <Button
        variant="outline"
        disabled
        aria-disabled
        title="E-invoice (IRN) and e-way bill generation are coming later"
      >
        Generate IRN — coming later
      </Button>
      {canCreateLr && (
        <Button onClick={createLr} disabled={pending}>
          Create LR from this invoice →
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div ref={topRef} className="scroll-mt-4">
        <PageHeader
          breadcrumb={[
            { label: "Tax invoices", href: "/invoices" },
            { label: invoiceNo ?? (invoice ? "Draft" : "New") },
          ]}
          breadcrumbPlacement="inline"
          title={
            <span className="flex flex-wrap items-center gap-3">
              <span>
                Tax invoice{" "}
                <span className="font-mono font-medium text-primary">
                  {invoiceNo ?? (invoice ? "draft" : "new")}
                </span>
              </span>
              {invoice && <InvoiceStatusChip status={status} />}
            </span>
          }
          actions={actions}
        />
      </div>

      {importInfo?.existing?.status === "draft" && (
        <Alert
          tone="warning"
          title={`Updates the existing draft ${importInfo.existing.invoiceNo}.`}
        >
          An invoice with this number from the same seller is already saved as a draft. Saving
          replaces its details with what was read from the file.
        </Alert>
      )}
      {(invoice?.importBatchId || importInfo) && (
        <Alert
          tone="info"
          title={`Read by AI from ${
            importInfo?.fileName ??
            (invoice?.sourceFileUrl ? uploadName(invoice.sourceFileUrl) : "the uploaded invoice")
          }`}
          action={<Link href="/import">Back to import</Link>}
        >
          · orange fields are new records or low-confidence — check them, everything is editable
        </Alert>
      )}
      {status === "cancelled" && (
        <Alert tone="warning" title="This invoice is CANCELLED.">
          {invoice?.cancelReason ? `Reason: ${invoice.cancelReason}. ` : ""}
          {invoiceNo ? `Number ${invoiceNo} stays used and is not issued again.` : ""}
        </Alert>
      )}
      {status === "final" && (
        <Alert tone="warning" title="Finalised — fields are locked.">
          To change it, cancel this invoice with a reason and issue a new one.
        </Alert>
      )}
      {readOnly && status === "draft" && (
        <Alert tone="warning" title="Imported from the consignor's invoice.">
          Shown read-only so it matches the original. Use Correct to fix a reading mistake.
        </Alert>
      )}
      {conflict && (
        <Alert
          tone="warning"
          title="Not saved — this invoice was changed by someone else since you opened it."
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload latest version
            </Button>
          }
        />
      )}
      {formError && (
        <div role="alert" className="text-sm text-danger">
          {formError}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_680px] flex-col gap-5">
          <section className={section}>
            <h2 className={h2}>Seller &amp; invoice</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="sm:col-span-2">
                <Field
                  label={imported ? "Seller (consignor)" : "Seller (billing company)"}
                  value={`${seller.name}${seller.gstin ? ` · ${seller.gstin}` : ""}`}
                  readOnly
                  disabled
                  {...(isPending(seller.partyId)
                    ? {
                        aiFlag: "new-record" as const,
                        aiNote: "New party — saved when you save the invoice",
                      }
                    : {})}
                />
              </div>
              <Field
                label="Invoice no."
                {...text("invoiceNo")}
                disabled={readOnly || !imported}
                placeholder={imported ? "" : "Given on Finalise"}
                className="[&_input]:font-mono [&_input]:placeholder:font-sans"
                error={errors.invoiceNo}
              />
              <DateTimeField
                label="Date & time"
                value={values.invoiceAt}
                onChange={(v) => set("invoiceAt", v)}
                disabled={readOnly}
                error={errors.invoiceAt}
              />
              <Field label="Customer ref." {...text("customerRef")} />
              <DateField
                label="Customer ref. date"
                value={values.customerRefDate}
                onChange={(v) => set("customerRefDate", v)}
                disabled={readOnly}
                error={errors.customerRefDate}
                {...flag("customerRefDate")}
              />
              <Field label="SO no." {...text("soNo")} />
              <DateField
                label="SO date"
                value={values.soDate}
                onChange={(v) => set("soDate", v)}
                disabled={readOnly}
                error={errors.soDate}
                {...flag("soDate")}
              />
              <Field label="DO no." {...text("doNo")} />
              <Field label="SAP ref." {...text("sapRef")} />
            </div>
          </section>

          <section className={section}>
            <h2 className={h2}>Bill to / Ship to</h2>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                {readOnly ? (
                  <PartyReadOnly label="Bill to" party={values.billTo} />
                ) : (
                  <PartyPicker
                    id="bill-to"
                    label="Bill to"
                    role="buyer"
                    party={values.billTo}
                    isNew={isPending(values.billTo?.id)}
                    onChange={(p) => set("billTo", p)}
                    error={errors.billToId}
                  />
                )}
              </div>
              <div className="flex flex-col gap-2">
                {readOnly ? (
                  <PartyReadOnly
                    label="Ship to"
                    party={values.shipSame ? null : values.shipTo}
                    sameAsBillTo={values.shipSame}
                  />
                ) : (
                  <>
                    {values.shipSame ? (
                      <Field label="Ship to" value="Same as bill to" readOnly disabled />
                    ) : (
                      <PartyPicker
                        id="ship-to"
                        label="Ship to"
                        role="ship-to party"
                        party={values.shipTo}
                        isNew={isPending(values.shipTo?.id)}
                        onChange={(p) => set("shipTo", p)}
                        error={errors.shipToId}
                      />
                    )}
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-label">
                      <input
                        type="checkbox"
                        checked={values.shipSame}
                        onChange={(e) => set("shipSame", e.target.checked)}
                        className="h-5 w-5"
                      />
                      Same as bill to
                    </label>
                  </>
                )}
                {needsStateChoice(values) && (
                  <Select
                    label="Buyer's state (unregistered, no GSTIN)"
                    value={values.placeOfSupply}
                    onChange={(e) => set("placeOfSupply", e.target.value)}
                    disabled={readOnly}
                    error={errors.placeOfSupplyStateCode}
                  >
                    <option value="">Choose state…</option>
                    {GST_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {stateLabel(s.code)}
                      </option>
                    ))}
                  </Select>
                )}
                {!needsStateChoice(values) && errors.placeOfSupplyStateCode && (
                  <div className="text-[13px] text-danger">{errors.placeOfSupplyStateCode}</div>
                )}
                <div className="text-[13px] leading-normal text-muted">
                  {pos && ship ? (
                    pos === seller.state ? (
                      <>Place of supply {stateLabel(pos)} = seller state → SGST + CGST</>
                    ) : (
                      <>
                        Place of supply {stateLabel(pos)} ≠ seller state
                        {seller.state ? ` ${stateLabel(seller.state)}` : ""} → IGST
                      </>
                    )
                  ) : (
                    "Place of supply = ship-to state; it decides SGST + CGST or IGST"
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className={section}>
            <h2 className={h2}>Transport (linked to LR)</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Transporter" {...text("transporterName")} />
              {readOnly ? (
                <Field
                  label="Vehicle no."
                  value={values.truck?.number ?? ""}
                  disabled
                  readOnly
                  className="[&_input]:font-mono"
                />
              ) : (
                <TruckPicker
                  id="vehicle"
                  label="Vehicle no."
                  truck={values.truck}
                  isNew={isPending(values.truck?.id)}
                  onChange={(t) =>
                    setValues((v) => ({
                      ...v,
                      truck: t,
                      driverMobile: v.driverMobile || t?.driverMobile || "",
                    }))
                  }
                  error={errors.truckId}
                />
              )}
              <Field label="Driver no." inputMode="tel" {...text("driverMobile")} />
              <Field
                label="LR no. & date"
                value={
                  linkedLrs.length
                    ? linkedLrs
                        .map((l) => `${l.lrNo}${l.lrDate ? ` · ${formatDate(l.lrDate)}` : ""}`)
                        .join(", ")
                    : "Not on an LR yet"
                }
                readOnly
                disabled
              />
              <div className="sm:col-span-2">
                <Field label="Ship from" {...text("shipFrom")} />
              </div>
              <div className="sm:col-span-2">
                <Select
                  label="Incoterm"
                  value={values.incoterm}
                  onChange={(e) => set("incoterm", e.target.value)}
                  disabled={readOnly}
                  error={errors.incoterm}
                >
                  <option value="">Not stated</option>
                  {values.incoterm &&
                    !(INCOTERMS as readonly string[]).includes(values.incoterm) && (
                      <option value={values.incoterm}>{values.incoterm}</option>
                    )}
                  {INCOTERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </section>

          <section className={section}>
            <h2 className="m-0 mb-3 text-[17px] font-bold">Items</h2>
            <InvoiceItemsTable
              rows={values.lines}
              onChange={(lines) => set("lines", lines)}
              taxes={shown.lines}
              totals={shown.totals}
              intraState={shown.intraState}
              readOnly={readOnly}
              errors={errors}
              flags={importInfo?.flags}
            />
          </section>
        </div>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          {(importInfo?.fileUrl ?? invoice?.sourceFileUrl) && (
            <SourceFile url={(importInfo?.fileUrl ?? invoice?.sourceFileUrl)!} />
          )}

          <section className={section}>
            <h2 className="m-0 mb-3 text-[17px] font-bold">Linked records</h2>
            <div className="flex flex-col gap-2.5 text-sm leading-normal">
              {linkedLrs.map((l) => (
                <Link key={l.id} href={`/lr/${l.id}`} className={tile}>
                  <b>LR {l.lrNo}</b> · {l.status.toLowerCase()}
                  <br />
                  <span className="text-muted">goods, value, truck copied from here</span>
                </Link>
              ))}
              {!linkedLrs.length && (
                <div className={cx(tile, "text-muted")}>
                  <b className="text-text">No LR yet</b>
                  <br />
                  {invoiceNo || imported
                    ? "Create LR from this invoice copies goods, value and truck."
                    : "Finalise to get a number, then create the LR."}
                </div>
              )}
              {total > EWAY_BILL_THRESHOLD_PAISE && (
                <div className="rounded-control border border-warning-border bg-warning-soft p-3 text-warning">
                  <b>E-way bill</b> · {invoice?.ewayBillNo ? invoice.ewayBillNo : "not generated"}
                  <br />
                  value {formatRupees(total)} &gt; ₹50,000 → e-way bill needed
                </div>
              )}
              {values.billTo && !isPending(values.billTo.id) && (
                <Link href={`/parties/${values.billTo.id}`} className={tile}>
                  <b>{values.billTo.name}</b>
                  <br />
                  <span className="text-muted">party profile · all invoices &amp; LRs</span>
                </Link>
              )}
            </div>
          </section>

          <section className={`${section} text-sm leading-relaxed`}>
            <h2 className="m-0 mb-2.5 text-[17px] font-bold">E-invoice</h2>
            <div>
              IRN: <span className="text-muted">e-invoice generation is coming later</span>
            </div>
            <div>
              QR code: <span className="text-muted">printed top-right once IRN exists</span>
            </div>
            <div>Copies: Original · Duplicate for transporter · Triplicate</div>
          </section>

          {invoice && status !== "cancelled" && canCancel && (
            <section className={`${section} text-sm`}>
              <h2 className="m-0 mb-2.5 text-[17px] font-bold">Cancel invoice</h2>
              <p className="mt-0 mb-3 text-muted">
                {invoiceNo
                  ? `Marks it CANCELLED. Number ${invoiceNo} stays used and is never re-issued.`
                  : "Marks the draft CANCELLED. Nothing is deleted."}
              </p>
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                Cancel invoice…
              </Button>
            </section>
          )}
        </aside>
      </div>

      <Dialog
        open={confirmFinal}
        onClose={() => setConfirmFinal(false)}
        title="Finalise this invoice?"
        description={
          imported
            ? `It keeps the seller's number ${values.invoiceNo || ""} and all fields are locked.`
            : `It gets the next number in this financial year's series${
                nextInvoiceNo ? ` (next: ${nextInvoiceNo})` : ""
              } and all fields are locked. To change it later you cancel it and issue a new one.`
        }
      >
        <div className="flex flex-col gap-3">
          <div className="text-sm">
            Invoice total <b>{formatRupees(total)}</b>
            {values.billTo && <> · bill to {values.billTo.name}</>}
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmFinal(false)}>
              Not yet
            </Button>
            <Button variant="dark" onClick={finalise} disabled={pending}>
              Yes, finalise
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={cancelling}
        onClose={() => {
          setCancelling(false);
          setCancelError(null);
        }}
        title={`Cancel invoice ${invoiceNo ?? "draft"}?`}
        description={
          invoiceNo
            ? `The number ${invoiceNo} stays used; the invoice shows as CANCELLED.`
            : "The draft shows as CANCELLED; nothing is deleted."
        }
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            cancelInvoice();
          }}
          className="flex flex-col gap-4"
        >
          <Textarea
            label="Reason"
            required
            autoFocus
            rows={3}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            error={cancelError ?? undefined}
          />
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              Keep invoice
            </Button>
            <Button type="submit" variant="danger" disabled={pending || !cancelReason.trim()}>
              {pending ? "Cancelling…" : "Yes, cancel invoice"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function PartyReadOnly({
  label,
  party,
  sameAsBillTo,
}: {
  label: string;
  party: InvoiceFormValues["billTo"];
  sameAsBillTo?: boolean;
}) {
  const shown = sameAsBillTo ? "Same as bill to" : party ? party.name : "—";
  return (
    <>
      <Field label={label} value={shown} readOnly disabled />
      {party && !sameAsBillTo && (
        <div className="text-[13px] leading-normal text-muted">
          {[party.gstin ? `GST ${party.gstin}` : "No GSTIN", party.phone]
            .filter(Boolean)
            .join(" · ")}
          {party.address && (
            <>
              <br />
              {party.address}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** The uploaded invoice shown beside the form so the two can be compared (Invoice.dc.html). */
function SourceFile({ url }: { url: string }) {
  const name = uploadName(url);
  const kind = /\.(jpe?g|png)$/i.test(name) ? "image" : /\.pdf$/i.test(name) ? "pdf" : "file";
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="m-0 mb-2.5 text-[17px] font-bold">Source file</h2>
      {kind === "image" && (
        // Private upload served from /uploads, not an optimisable static image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Uploaded invoice ${name}`}
          className="w-full rounded-control border border-border"
        />
      )}
      {kind === "pdf" && (
        <iframe
          src={url}
          title={`Uploaded invoice ${name}`}
          className="h-[520px] w-full rounded-control border border-border"
        />
      )}
      <p className="mt-2 mb-0 text-[13px] text-muted">
        Compare side by side ·{" "}
        <a href={url} target="_blank" rel="noopener">
          open {kind === "file" ? "the file" : "full size"}
        </a>
      </p>
    </section>
  );
}

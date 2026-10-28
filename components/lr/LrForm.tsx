"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  consignorDefaultsAction,
  saveLrAction,
  type SaveLrResult,
} from "@/app/(app)/lr/form-actions";
import { LrStatusChip } from "@/components/LrStatusChip";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { cx } from "@/lib/cx";
import { formatPaise, formatRupees } from "@/lib/format";
import { paymentModeLabel } from "@/lib/labels";
import {
  bookingErrors,
  describeDefaults,
  FORM_CHARGES,
  formToLrInput,
  gstApplies,
  lrChargeTotals,
  lrChecklist,
  tidyRupees,
  type FormErrors,
  type LrFormValues,
  type PartyOption,
  type TruckOption,
} from "@/lib/lr-form";
import type { GstPayer, LrPaymentMode, LrStatus } from "@/lib/types";
import { LrChecklist } from "./LrChecklist";
import { LrGoodsTable } from "./LrGoodsTable";
import { LrInvoicesEditor } from "./LrInvoicesEditor";
import { PartyPicker } from "./PartyPicker";
import { TruckPicker } from "./TruckPicker";

type Picked = {
  consignor: PartyOption | null;
  consignee: PartyOption | null;
  billedTo: PartyOption | null;
  truck: TruckOption | null;
};

export type LrFormProps = {
  initial: LrFormValues;
  picked: Picked;
  /** Edit: the saved LR. New: absent. */
  lr?: { id: string; lrNo: string; version: number; status: LrStatus; booked: boolean };
  /** New: the number the LR will probably get (allocated on save). */
  nextLrNo?: string | null;
  /** New LR from ?from= */
  copiedFrom?: { lrNo: string } | null;
  /** Goods invoices on this LR that came from a tax invoice. */
  linkedInvoice?: { id: string; invoiceNo: string } | null;
  /** Shown once after a redirect, e.g. "Draft saved". */
  notice?: string | null;
  /** Why the LR can't be edited (e.g. cancelled); the form is shown disabled. */
  readOnlyReason?: string | null;
};

type DefaultsFill = {
  lrNo: string | null;
  text: string;
  consignorName: string;
  gstPaidBy: GstPayer | null;
  previous: Pick<LrFormValues, "fromPlace" | "chargedAs" | "paymentMode" | "gstPaidBy">;
};

const GST_PAYERS: { value: GstPayer; label: string }[] = [
  { value: "consignor", label: "Consignor" },
  { value: "consignee", label: "Consignee" },
  { value: "transporter", label: "Transporter – charge extra" },
];

const PAYMENT_MODES: LrPaymentMode[] = ["to_pay", "paid", "tbb"];
/** The design writes TBB with dots on this screen. */
const paymentModeText = (m: LrPaymentMode) => (m === "tbb" ? "T.B.B." : paymentModeLabel[m]);

/** New / Edit LR (NewLR.dc.html). */
export function LrForm({
  initial,
  picked: initialPicked,
  lr,
  nextLrNo,
  copiedFrom,
  linkedInvoice,
  notice: initialNotice,
  readOnlyReason,
}: LrFormProps) {
  const readOnly = !!readOnlyReason;
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [picked, setPicked] = useState(initialPicked);
  const [newPartyIds, setNewPartyIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [notice, setNotice] = useState(initialNotice ?? null);
  const [defaults, setDefaults] = useState<DefaultsFill | null>(null);
  const [pending, startTransition] = useTransition();
  const [focusError, setFocusError] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);
  const defaultsRequest = useRef(0);

  // After a failed save, move to the first field with an error.
  useEffect(() => {
    if (!focusError) return;
    const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    // Payment mode marks its fieldset; focus its first radio.
    const target = el?.matches("fieldset") ? el.querySelector<HTMLElement>("input") : el;
    if (target) target.focus();
    else topRef.current?.scrollIntoView({ block: "start" });
  }, [focusError]);

  const set = (patch: Partial<LrFormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setNotice(null);
    const keys = Object.keys(patch);
    setErrors((e) => {
      if (!keys.some((k) => Object.keys(e).some((p) => p === k || p.startsWith(`${k}.`)))) return e;
      return Object.fromEntries(
        Object.entries(e).filter(([p]) => !keys.some((k) => p === k || p.startsWith(`${k}.`))),
      );
    });
  };

  const totals = lrChargeTotals(values);
  const checklist = useMemo(
    () => lrChecklist(values, picked.consignor),
    [values, picked.consignor],
  );
  const booked = !!lr?.booked;

  async function pickConsignor(party: PartyOption | null, created?: boolean) {
    const changed = party?.id !== values.consignorId;
    setPicked((p) => ({ ...p, consignor: party }));
    if (created && party) setNewPartyIds((ids) => [...ids, party.id]);
    set({ consignorId: party?.id ?? null });
    if (!party || !changed) return;
    // Values before any fill, so Undo goes back to what the user had.
    const previous = defaults?.previous ?? {
      fromPlace: values.fromPlace,
      chargedAs: values.chargedAs,
      paymentMode: values.paymentMode,
      gstPaidBy: values.gstPaidBy,
    };
    const req = ++defaultsRequest.current;
    const d = await consignorDefaultsAction(party.id);
    if (req !== defaultsRequest.current) return; // another consignor was picked meanwhile
    if (!d) {
      if (defaults) set(defaults.previous);
      setDefaults(null);
      return;
    }
    setDefaults({
      lrNo: d.lrNo,
      text: describeDefaults(d),
      consignorName: party.name,
      gstPaidBy: d.gstPaidBy,
      previous,
    });
    set({
      fromPlace: d.fromPlace ?? previous.fromPlace,
      chargedAs: d.chargedAs ?? previous.chargedAs,
      paymentMode: d.paymentMode ?? previous.paymentMode,
      gstPaidBy: d.gstPaidBy ?? previous.gstPaidBy,
    });
  }

  function undoDefaults() {
    if (!defaults) return;
    set(defaults.previous);
    setDefaults(null);
  }

  function pickParty(role: "consignee" | "billedTo", party: PartyOption | null, created?: boolean) {
    setPicked((p) => ({ ...p, [role]: party }));
    if (created && party) setNewPartyIds((ids) => [...ids, party.id]);
    if (role === "consignee") set({ consigneeId: party?.id ?? null });
    // An empty billed-to means "same as consignee".
    else set({ billedToId: party?.id ?? null, billedToSame: !party });
  }

  function pickTruck(truck: TruckOption | null) {
    setPicked((p) => ({ ...p, truck }));
    set({
      truckId: truck?.id ?? null,
      // Fill the driver's mobile from the truck when it's still empty.
      ...(truck?.driverMobile && !values.driverMobile.trim()
        ? { driverMobile: truck.driverMobile }
        : {}),
    });
  }

  function save(book: boolean) {
    setFormError(null);
    setConflict(null);
    setNotice(null);
    const { input, errors: fieldErrors, toFormPath } = formToLrInput(values);
    const all = book ? { ...bookingErrors(values), ...fieldErrors } : fieldErrors;
    if (Object.keys(all).length) {
      setErrors(all);
      setFormError(
        book ? "Fill the marked fields to book the LR." : "Fix the marked fields to save.",
      );
      setFocusError((n) => n + 1);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result: SaveLrResult = await saveLrAction({
        id: lr?.id,
        expectedVersion: lr?.version,
        input,
        book,
      });
      if (result.ok) {
        // Booked → LR detail. Otherwise reload the edit page so ids and version are fresh.
        if (book && !booked) router.push(`/lr/${result.id}`);
        else router.replace(`/lr/${result.id}/edit?saved=1`);
        return;
      }
      if (result.kind === "conflict") {
        setConflict(result.message);
      } else if (result.kind === "validation") {
        const byField: FormErrors = {};
        const general: string[] = [];
        for (const issue of result.issues) {
          if (issue.path) byField[toFormPath(issue.path)] = issue.message;
          else general.push(issue.message);
        }
        setErrors(byField);
        setFormError(general.join(" ") || "Fix the marked fields to save.");
      } else {
        setFormError(result.message);
      }
      setFocusError((n) => n + 1);
    });
  }

  const title = lr ? (
    <>
      Edit LR <span className="font-mono text-primary">{lr.lrNo}</span>{" "}
      <span className="align-middle">
        <LrStatusChip status={lr.status} />
      </span>
    </>
  ) : (
    <>
      New LR {nextLrNo && <span className="font-mono text-primary">{nextLrNo}</span>}{" "}
      <span className="text-[13px] font-medium text-muted">auto-numbered</span>
    </>
  );

  const disabled = readOnly || pending;
  const actions = (
    <>
      {!booked && (
        <Button variant="secondary" onClick={() => save(false)} disabled={disabled}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
      )}
      <Button variant="secondary" href={lr ? `/pdf/lr/${lr.id}` : "#"} newTab disabled={!lr}>
        Preview PDF
      </Button>
      <Button variant="dark" onClick={() => save(true)} disabled={disabled}>
        {booked ? "Save changes" : "Save & book"}
      </Button>
    </>
  );

  const gstOn = gstApplies(values);

  return (
    <>
      <div ref={topRef} className="scroll-mt-4">
        <PageHeader
          breadcrumb={
            lr
              ? [
                  { label: "LR register", href: "/lr" },
                  { label: `LR ${lr.lrNo}`, href: `/lr/${lr.id}` },
                  { label: "Edit" },
                ]
              : [{ label: "Dashboard", href: "/" }, { label: "New consignment note" }]
          }
          breadcrumbPlacement="inline"
          title={title}
          actions={actions}
        />
      </div>

      {readOnlyReason && <Alert tone="warning">{readOnlyReason}</Alert>}
      {conflict && (
        <Alert
          tone="warning"
          title="Not saved — this LR was changed by someone else since you opened it."
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
        <Alert tone="warning" title="Not saved.">
          {formError}
        </Alert>
      )}
      {notice && (
        <div role="status" className="rounded-tile bg-success-soft px-4 py-3 text-sm text-success">
          <b>{notice}</b>
        </div>
      )}

      {linkedInvoice && (
        <Alert
          tone="info"
          title={`Linked to tax invoice ${linkedInvoice.invoiceNo}`}
          action={<Link href={`/invoices/${linkedInvoice.id}`}>Open invoice</Link>}
        >
          · parties, goods, value, truck copied
          {values.invoices.some((r) => r.taxInvoiceId && !r.ewayBillNo.trim()) &&
            " · e-way bill pending"}
        </Alert>
      )}

      {copiedFrom && (
        <Banner>
          <b>Copied from LR {copiedFrom.lrNo}:</b>
          <span className="text-label">date, goods invoices and e-way bills left blank</span>
        </Banner>
      )}

      {defaults && (
        <Banner>
          <b>
            {defaults.lrNo
              ? `Defaults filled from this consignor’s last LR (${defaults.lrNo}):`
              : "Defaults filled from this consignor’s saved settings:"}
          </b>
          <span className="text-label">{defaults.text}</span>
          <button
            type="button"
            onClick={undoDefaults}
            className="ml-auto min-h-9 cursor-pointer rounded-control border border-border-input bg-surface px-3 font-semibold"
          >
            Undo
          </button>
        </Banner>
      )}

      <form
        noValidate
        // Enter in a box shouldn't save; saving is only through the buttons.
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-wrap items-start gap-5"
      >
        <fieldset disabled={readOnly} className="m-0 contents border-0 p-0">
          <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-5">
            <Card title="Booking">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field
                  id="lrDate"
                  label="LR date"
                  type="date"
                  value={values.lrDate}
                  onChange={(e) => set({ lrDate: e.target.value })}
                  error={errors.lrDate}
                />
                <Field
                  id="fromPlace"
                  label="From"
                  value={values.fromPlace}
                  onChange={(e) => set({ fromPlace: e.target.value })}
                  error={errors.fromPlace}
                />
                <Field
                  id="toPlace"
                  label="To"
                  value={values.toPlace}
                  onChange={(e) => set({ toPlace: e.target.value })}
                  error={errors.toPlace}
                />
                <Select
                  id="risk"
                  label="Risk"
                  value={values.risk}
                  onChange={(e) => set({ risk: e.target.value as LrFormValues["risk"] })}
                  error={errors.risk}
                >
                  <option value="owner">At owner&apos;s risk</option>
                  <option value="carrier">At carrier&apos;s risk</option>
                </Select>
              </div>
            </Card>

            <Card title="Parties">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <PartyPicker
                  id="consignorId"
                  label="Consignor"
                  role="consignor"
                  party={picked.consignor}
                  isNew={!!picked.consignor && newPartyIds.includes(picked.consignor.id)}
                  onChange={pickConsignor}
                  error={errors.consignorId}
                />
                <PartyPicker
                  id="consigneeId"
                  label="Consignee"
                  role="consignee"
                  party={picked.consignee}
                  isNew={!!picked.consignee && newPartyIds.includes(picked.consignee.id)}
                  onChange={(p, created) => pickParty("consignee", p, created)}
                  error={errors.consigneeId}
                />
                <PartyPicker
                  id="billedToId"
                  label="Billed to"
                  role="billed-to party"
                  party={values.billedToSame ? null : picked.billedTo}
                  isNew={!!picked.billedTo && newPartyIds.includes(picked.billedTo.id)}
                  selectedTextOverride={values.billedToSame ? "Same as consignee" : undefined}
                  pinned={[
                    {
                      key: "same",
                      label: <b>Same as consignee</b>,
                      onSelect: () => set({ billedToSame: true, billedToId: null }),
                    },
                  ]}
                  onChange={(p, created) => pickParty("billedTo", p, created)}
                  error={errors.billedToId}
                />
                <Select
                  id="gstPaidBy"
                  label="GST payable by"
                  value={values.gstPaidBy}
                  onChange={(e) => set({ gstPaidBy: e.target.value as GstPayer | "" })}
                  error={errors.gstPaidBy}
                >
                  <option value="">Choose…</option>
                  {GST_PAYERS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                      {defaults?.gstPaidBy === g.value && values.gstPaidBy === g.value
                        ? ` (remembered for ${defaults.consignorName})`
                        : ""}
                    </option>
                  ))}
                </Select>
              </div>
            </Card>

            <Card title="Vehicle & documents">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <TruckPicker
                  id="truckId"
                  truck={picked.truck}
                  onChange={pickTruck}
                  error={errors.truckId}
                />
                <Field
                  id="driverMobile"
                  label="Driver mobile"
                  type="tel"
                  inputMode="tel"
                  value={values.driverMobile}
                  onChange={(e) => set({ driverMobile: e.target.value })}
                  error={errors.driverMobile}
                />
                <LrInvoicesEditor
                  rows={values.invoices}
                  onChange={(invoices) => set({ invoices })}
                  errors={errors}
                />
              </div>
            </Card>

            <Card title="Goods" className="[&>div:first-child]:mb-3">
              <LrGoodsTable
                rows={values.items}
                chargedAs={values.chargedAs}
                onRowsChange={(items) => set({ items })}
                onChargedAsChange={(chargedAs) => set({ chargedAs })}
                errors={errors}
              />
            </Card>

            <Card title="Freight & payment">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {FORM_CHARGES.map(({ key, label }) => {
                  const isGst = key === "gst";
                  const off = isGst && !gstOn;
                  return (
                    <Field
                      key={key}
                      id={`charges.${key}`}
                      label={label}
                      inputMode="decimal"
                      placeholder={
                        off
                          ? values.gstPaidBy
                            ? `Paid by ${values.gstPaidBy}`
                            : "Pick GST payer"
                          : "₹"
                      }
                      disabled={off}
                      value={off ? "" : values.charges[key]}
                      onChange={(e) =>
                        set({ charges: { ...values.charges, [key]: e.target.value } })
                      }
                      onBlur={(e) =>
                        set({
                          charges: { ...values.charges, [key]: tidyRupees(e.target.value) },
                        })
                      }
                      error={errors[`charges.${key}`]}
                    />
                  );
                })}
                <Field
                  id="balance"
                  label="Balance"
                  readOnly
                  tabIndex={-1}
                  placeholder="Auto = total − advance"
                  value={
                    totals.totalPaise || totals.advancePaise ? formatPaise(totals.balancePaise) : ""
                  }
                  hint={
                    totals.totalPaise
                      ? `Total ${formatRupees(totals.totalPaise)} − advance ${formatRupees(totals.advancePaise)}`
                      : undefined
                  }
                  className="[&_input]:bg-page"
                />
              </div>
              <fieldset
                className="m-0 mt-4 flex flex-wrap gap-3 border-0 p-0"
                aria-invalid={errors.paymentMode ? true : undefined}
                aria-describedby={errors.paymentMode ? "paymentMode-msg" : undefined}
              >
                <legend className="mb-2 p-0 text-[13px] font-semibold text-label">
                  Payment mode
                </legend>
                {PAYMENT_MODES.map((m) => {
                  const on = values.paymentMode === m;
                  return (
                    <label
                      key={m}
                      className={cx(
                        "inline-flex h-control cursor-pointer items-center gap-2 rounded-control px-4 text-sm",
                        on
                          ? "border-2 border-primary bg-primary-soft px-[15px] font-semibold"
                          : "border border-border-input font-medium",
                      )}
                    >
                      <input
                        type="radio"
                        name="paymentMode"
                        id={m === PAYMENT_MODES[0] ? "paymentMode" : undefined}
                        value={m}
                        checked={on}
                        onChange={() => set({ paymentMode: m })}
                      />
                      {paymentModeText(m)}
                    </label>
                  );
                })}
              </fieldset>
              {errors.paymentMode && (
                <div id="paymentMode-msg" className="mt-1.5 text-[13px] text-danger">
                  {errors.paymentMode}
                </div>
              )}
            </Card>
          </div>

          <aside className="flex flex-[1_1_300px] flex-col gap-4">
            <LrChecklist lines={checklist} />
          </aside>
        </fieldset>
      </form>
    </>
  );
}

/** White bordered strip used for "Defaults filled …" and "Copied from …". */
function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-tile border border-border bg-surface px-4 py-2.5 text-sm">
      {children}
    </div>
  );
}

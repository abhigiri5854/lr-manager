"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  cancelBillAction,
  finaliseBillAction,
  loadBillPartyAction,
  saveBillAction,
} from "@/app/(app)/bills/actions";
import type { BillPartyData } from "@/app/(app)/bills/load-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DateField, focusFirstInvalidDate } from "@/components/ui/DateField";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { useCan } from "@/components/ui/Permissions";
import { billPaymentStatus } from "@/lib/bill-status";
import {
  formToBillInput,
  lineFromRow,
  liveBillTotals,
  serverErrorKey,
  type BillFormErrors,
  type BillFormValues,
  type BillLineValues,
  type BillLrRow,
} from "@/lib/bill-form";
import { dateWarning, joinWarnings, numberFyWarning } from "@/lib/date-warnings";
import { amountInWords, formatDate, formatRupees } from "@/lib/format";
import { todayInIndia } from "@/lib/fy";
import { formatGstRate } from "@/lib/gst";
import type { FreightBillView } from "@/lib/types";
import { BillStatusChip } from "./BillStatusChip";
import { CancelReasonDialog } from "./CancelReasonDialog";
import { PaymentForm, type PaymentPartyOption } from "./PaymentForm";

const section = "rounded-card border border-border bg-surface p-5";

/**
 * New / edit freight bill (FreightBill.dc.html): pick a party → its unbilled LRs appear → tick →
 * bill. Drafts are editable; Finalise allocates the number and marks the LRs Billed; a final
 * bill keeps everything locked except its date.
 */
export function BillForm({
  bill,
  initial,
  data,
  parties,
  company,
}: {
  bill: FreightBillView | null;
  initial: BillFormValues;
  /** The initial party's LRs (edit page, or /bills/new?party=). */
  data: BillPartyData | null;
  parties: PaymentPartyOption[];
  company: { label: string; freightBillPrefix: string; freightGstRateBp: number };
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [rows, setRows] = useState<BillLrRow[]>(data?.rows ?? []);
  const [intraState, setIntraState] = useState(data?.intraState ?? true);
  const [errors, setErrors] = useState<BillFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [paying, setPaying] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loadingParty, startLoadingParty] = useTransition();
  const topRef = useRef<HTMLDivElement>(null);
  const [initialJson, setInitialJson] = useState(() => JSON.stringify(initial));
  const [today] = useState(() => todayInIndia());
  const [dateSaved, setDateSaved] = useState(false);
  const canCancel = useCan("record.cancel");
  const canPay = useCan("bill.edit");

  const status = bill ? billPaymentStatus(bill) : "draft";
  const locked = status !== "draft";
  const datesOnly = bill?.status === "final" && !bill.cancelledAt;
  const dirty = JSON.stringify(values) !== initialJson;
  const gstRateBp = (bill?.gstRateBp || 0) || company.freightGstRateBp;

  const lineOf = (r: BillLrRow): BillLineValues => values.lines[r.lrId] ?? lineFromRow(r);
  const ticked = rows.filter((r) => lineOf(r).ticked);
  const live = useMemo(
    () => liveBillTotals(values, gstRateBp, intraState),
    [values, gstRateBp, intraState],
  );
  const totals = locked && bill ? bill.totals : live;

  // Ticked rows always stay visible; the LR-date range only hides the rest.
  const shown = locked
    ? ticked
    : rows.filter((r) => {
        if (lineOf(r).ticked) return true;
        if (values.from && (!r.lrDate || r.lrDate < values.from)) return false;
        if (values.to && (!r.lrDate || r.lrDate > values.to)) return false;
        return true;
      });
  const podAwaited = ticked.filter((r) => !r.podReceived);

  const billDateWarning = joinWarnings(
    dateWarning(values.billDate, { today }),
    numberFyWarning(bill?.numberFy, values.billDate),
  );

  function showErrors(e: BillFormErrors, message?: string) {
    setErrors(e);
    setFormError(message ?? (Object.keys(e).length ? "Check the highlighted fields." : null));
    topRef.current?.scrollIntoView({ block: "start" });
  }

  function changeParty(partyId: string) {
    setValues((v) => ({ ...v, partyId, lines: {} }));
    setRows([]);
    setErrors({});
    if (!partyId) return;
    startLoadingParty(async () => {
      const d = await loadBillPartyAction(partyId);
      setRows(d.rows);
      setIntraState(d.intraState);
    });
  }

  function setLine(r: BillLrRow, patch: Partial<BillLineValues>) {
    setValues((v) => ({
      ...v,
      lines: { ...v.lines, [r.lrId]: { ...(v.lines[r.lrId] ?? lineFromRow(r)), ...patch } },
    }));
  }

  /** Saves if needed; resolves to the saved id + version, or null on failure. */
  async function saveIfNeeded(): Promise<{ id: string; version: number } | null> {
    if (bill && (locked || !dirty)) return { id: bill.id, version: bill.version };
    if (focusFirstInvalidDate()) return null;
    const built = formToBillInput(values, rows, gstRateBp);
    if (!built.ok) {
      showErrors(built.errors);
      return null;
    }
    const r = await saveBillAction({
      id: bill?.id,
      expectedVersion: bill?.version,
      input: built.input,
    });
    if (r.ok) {
      setErrors({});
      setFormError(null);
      return { id: r.id, version: r.version };
    }
    if (r.kind === "conflict") setConflict(true);
    else if (r.kind === "validation") {
      const order = (built.input.lines ?? []).map((l) => l.lrId);
      showErrors(
        Object.fromEntries(
          r.issues.filter((i) => i.path).map((i) => [serverErrorKey(i.path, order), i.message]),
        ),
        r.message,
      );
    } else showErrors({}, r.message);
    return null;
  }

  function saveDraft() {
    startTransition(async () => {
      const saved = await saveIfNeeded();
      if (saved && !bill) router.replace(`/bills/${saved.id}`);
    });
  }

  /** Finalised bill: only the date can change. */
  function saveDate() {
    if (!bill || focusFirstInvalidDate()) return;
    if (!values.billDate) return showErrors({ billDate: "Enter the bill date" });
    startTransition(async () => {
      const r = await saveBillAction({
        id: bill.id,
        expectedVersion: bill.version,
        input: { billDate: values.billDate },
      });
      if (r.ok) {
        setErrors({});
        setFormError(null);
        setInitialJson(JSON.stringify(values));
        setDateSaved(true);
      } else if (r.kind === "conflict") setConflict(true);
      else showErrors({}, r.message);
    });
  }

  function finalise() {
    setConfirmFinal(false);
    startTransition(async () => {
      const saved = await saveIfNeeded();
      if (!saved) return;
      const r = await finaliseBillAction(saved.id, saved.version);
      if (!r.ok) {
        if (r.kind === "conflict") setConflict(true);
        else showErrors({}, r.message);
      }
      if (!bill) router.replace(`/bills/${saved.id}`);
    });
  }

  const columns: Column<BillLrRow>[] = [
    {
      key: "tick",
      header: "",
      cell: (r) => (
        <Checkbox
          checked={lineOf(r).ticked}
          onChange={(t) => setLine(r, { ticked: t })}
          className="min-h-0"
        >
          <span className="sr-only">Bill LR {r.lrNo}</span>
        </Checkbox>
      ),
    },
    { key: "lr", header: "LR No", cell: (r) => <b>{r.lrNo}</b>, mono: true },
    { key: "date", header: "Date", cell: (r) => (r.lrDate ? formatDate(r.lrDate) : "—") },
    { key: "inv", header: "Goods invoice", cell: (r) => r.invoiceNos || "—", mono: true, wrap: true },
    { key: "consignee", header: "Consignee", cell: (r) => r.consignee, wrap: true },
    { key: "route", header: "Route", cell: (r) => r.route || "—", wrap: true },
    { key: "truck", header: "Truck", cell: (r) => r.truck || "—", mono: true },
    ...(["freight", "detention", "other", "advance"] as const).map(
      (f): Column<BillLrRow> => ({
        key: f,
        header: { freight: "Freight ₹", detention: "Detention ₹", other: "Other ₹", advance: "Advance ₹" }[f],
        align: "right",
        cell: (r) => {
          const l = lineOf(r);
          if (!l.ticked && locked) return "—";
          return (
            <Field
              label={`${f} for LR ${r.lrNo}`}
              hideLabel
              inputMode="decimal"
              placeholder={f === "freight" ? "from LR" : "0.00"}
              value={l[f]}
              onChange={(e) => setLine(r, { [f]: e.target.value })}
              disabled={locked || !l.ticked}
              error={errors[`line.${r.lrId}.${f}`]}
              className="w-28 text-right"
            />
          );
        },
      }),
    ),
    {
      key: "pod",
      header: "POD",
      cell: (r) =>
        r.podReceived ? (
          <span className="text-success">Received</span>
        ) : (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[13px] text-warning">
            Pending
          </span>
        ),
    },
  ];

  const billNo = bill?.billNo ?? null;
  const taxLabel =
    values.gstMode === "reverse_charge"
      ? "Nil – reverse charge"
      : intraState
        ? `SGST ${formatRupees(totals.sgstPaise)} + CGST ${formatRupees(totals.cgstPaise)}`
        : `IGST ${formatRupees(totals.igstPaise)}`;

  const actions = (
    <div className="flex flex-wrap gap-3">
      {!locked && (
        <Button variant="secondary" onClick={saveDraft} disabled={pending || conflict}>
          {pending ? "Saving…" : bill ? "Save changes" : "Save draft"}
        </Button>
      )}
      {datesOnly && dirty && (
        <Button variant="secondary" onClick={saveDate} disabled={pending || conflict}>
          {pending ? "Saving…" : "Save date"}
        </Button>
      )}
      {!locked && (
        <Button
          variant="dark"
          onClick={() => setConfirmFinal(true)}
          disabled={pending || conflict}
        >
          Finalise
        </Button>
      )}
      {datesOnly && canPay && bill && bill.duePaise > 0 && (
        <Button onClick={() => setPaying(true)}>Record payment</Button>
      )}
      {bill && !bill.cancelledAt && canCancel && (
        <Button variant="secondary" onClick={() => setCancelling(true)} disabled={pending}>
          Cancel bill
        </Button>
      )}
      <Button variant="secondary" href={bill ? `/pdf/bill/${bill.id}` : "#"} newTab disabled={!bill}>
        Preview PDF
      </Button>
      <Button
        variant="dark"
        href={bill ? `/pdf/bill/${bill.id}?download=1` : "#"}
        download
        disabled={!bill}
      >
        Download PDF
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div ref={topRef} className="scroll-mt-4">
        <PageHeader
          breadcrumb={[
            { label: "Bills & payments", href: "/bills" },
            { label: billNo ?? (bill ? "Draft" : "New") },
          ]}
          breadcrumbPlacement="inline"
          title={
            <span className="flex flex-wrap items-center gap-3">
              <span>
                {bill ? "Freight bill" : "New freight bill"}{" "}
                <span className="font-mono font-medium text-primary">
                  {billNo ?? `${company.freightBillPrefix}[next]`}
                </span>
              </span>
              {bill && <BillStatusChip status={status} />}
            </span>
          }
          subtitle="Pick a party → its unbilled LRs appear → tick → bill. Billed LRs are locked."
          actions={actions}
        />
      </div>

      {conflict && (
        <Alert
          tone="info"
          title="Not saved — this bill was changed by someone else since you opened it."
          action={<Button variant="outline" onClick={() => router.refresh()}>Reload latest version</Button>}
        />
      )}
      {formError && !conflict && (
        <div role="alert" className="rounded-control border border-danger bg-surface p-3 text-sm text-danger">
          {formError}
        </div>
      )}
      {bill?.cancelledAt && (
        <Alert tone="warning" title="This bill is CANCELLED.">
          {bill.cancelReason ? `Reason: ${bill.cancelReason}. ` : ""}
          {billNo ? `Number ${billNo} stays used and is not issued again.` : ""}
        </Alert>
      )}
      {datesOnly && (
        <Alert tone="warning" title="Finalised — only the bill date can change.">
          To change anything else, cancel this bill with a reason and issue a new one.
        </Alert>
      )}
      {dateSaved && !dirty && (
        <div role="status" className="rounded-tile bg-success-soft px-4 py-3 text-sm text-success">
          <b>Date saved.</b>
        </div>
      )}

      <section className={section} aria-label="Bill details">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Select
            label="Bill to (party)"
            value={values.partyId}
            onChange={(e) => changeParty(e.target.value)}
            disabled={!!bill}
            error={errors.partyId}
          >
            <option value="">Select party…</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.place ? `${p.name} – ${p.place}` : p.name}
              </option>
            ))}
          </Select>

          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[13px] font-semibold text-label">LRs dated</legend>
            <div className="flex items-center gap-2">
              <DateField
                label="LRs from"
                hideLabel
                value={values.from}
                onChange={(from) => setValues((v) => ({ ...v, from }))}
                disabled={locked}
                className="min-w-32 flex-1"
              />
              <span aria-hidden className="text-muted">
                –
              </span>
              <DateField
                label="LRs to"
                hideLabel
                value={values.to}
                onChange={(to) => setValues((v) => ({ ...v, to }))}
                disabled={locked}
                className="min-w-32 flex-1"
              />
            </div>
          </fieldset>

          <Select
            label="GST on freight"
            value={values.gstMode}
            onChange={(e) =>
              setValues((v) => ({ ...v, gstMode: e.target.value as BillFormValues["gstMode"] }))
            }
            disabled={locked}
            hint={
              values.gstMode === "forward_charge"
                ? `${formatGstRate(gstRateBp)} — ${intraState ? "SGST + CGST" : "IGST"}`
                : undefined
            }
          >
            <option value="reverse_charge">Reverse charge – party pays GST</option>
            <option value="forward_charge">Forward charge – {company.label} charges GST</option>
          </Select>

          <DateField
            label="Bill date"
            value={values.billDate}
            onChange={(billDate) => setValues((v) => ({ ...v, billDate }))}
            disabled={!!bill?.cancelledAt}
            error={errors.billDate}
            warning={billDateWarning}
          />
        </div>
      </section>

      <section className={`${section} !p-2 pb-4`} aria-label="LRs to bill">
        <DataTable
          label="LRs to bill"
          columns={columns}
          rows={shown}
          rowKey={(r) => r.lrId}
          rowTone={(r) => (lineOf(r).ticked && !r.podReceived ? "warning" : undefined)}
          empty={
            !values.partyId
              ? "Pick a party to see its unbilled LRs."
              : loadingParty
                ? "Loading LRs…"
                : "No unbilled booked LRs for this party."
          }
        />
        {errors.lines && <div className="mx-3 mt-2 text-sm text-danger">{errors.lines}</div>}

        <div className="mx-3 mt-4 flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-xl text-[13px] text-warning">
            {podAwaited.length > 0 && (
              <p className="m-0">
                {podAwaited.map((r) => `LR ${r.lrNo}`).join(", ")} POD not received — you can still
                bill, but the bill prints &quot;POD awaited&quot;. Upload the POD photo from the LR.
              </p>
            )}
          </div>
          <dl className="m-0 w-full max-w-80 text-sm">
            <Row label="Freight + charges" value={formatRupees(totals.chargesPaise)} />
            <Row label="GST" value={taxLabel} />
            <Row label="Less advance" value={formatRupees(totals.advancePaise)} />
            <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2 text-[18px] font-bold">
              <dt>Bill amount</dt>
              <dd className="m-0">{formatRupees(totals.amountPaise)}</dd>
            </div>
            {totals.amountPaise >= 0 && (
              <p className="mt-1 mb-0 text-[13px] text-muted">{amountInWords(totals.amountPaise)}</p>
            )}
            {datesOnly && bill && (
              <>
                <Row label="Received" value={formatRupees(bill.receivedPaise)} />
                <Row label="Due" value={formatRupees(bill.duePaise)} />
              </>
            )}
          </dl>
        </div>
      </section>

      <p className="m-0 text-[13px] text-muted">
        Payments, TDS and dues are recorded in <Link href="/bills">Bills &amp; payments</Link>.
      </p>

      <Dialog
        open={confirmFinal}
        onClose={() => setConfirmFinal(false)}
        title="Finalise this bill?"
        description="A bill number is allocated and its LRs become Billed. Afterwards only the bill date can change."
      >
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmFinal(false)}>
            Keep editing
          </Button>
          <Button variant="dark" onClick={finalise} disabled={pending}>
            Finalise
          </Button>
        </div>
      </Dialog>

      <CancelReasonDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={`Cancel ${billNo ?? "this draft bill"}?`}
        description="Its LRs become unbilled again. A final bill's number stays used. Refused while payments are recorded against it."
        confirmLabel="Cancel bill"
        onConfirm={async (reason) => {
          const r = await cancelBillAction(bill!.id, reason);
          return r.ok ? null : r.message;
        }}
      />

      {bill && (
        <Dialog
          open={paying}
          onClose={() => setPaying(false)}
          title={`Record payment · ${billNo}`}
          description="Allocated to this bill first, then the party's older bills."
        >
          <PaymentForm
            parties={parties}
            partyId={bill.partyId}
            billId={bill.id}
            onDone={() => setPaying(false)}
            onCancel={() => setPaying(false)}
          />
        </Dialog>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0">{value}</dd>
    </div>
  );
}

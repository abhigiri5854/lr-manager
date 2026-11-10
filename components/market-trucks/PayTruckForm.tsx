"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  payableChallansAction,
  savePaymentAction,
  searchPayeesAction,
} from "@/app/(app)/market-trucks/payments/actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { DateField, focusFirstInvalidDate } from "@/components/ui/DateField";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { formatDate, formatPaise } from "@/lib/format";
import { calcTruckPayment, fromPaise, toPaise } from "@/lib/hire";
import type { PayeePick } from "@/lib/truck-payee-pick";
import type { PayableChallan } from "@/lib/types";
import { TRUCK_PAYMENT_MODES, type TruckPaymentInput } from "@/lib/validators/truck-payment";
import { paymentModeLabel } from "./labels";

type Line = { selected: boolean; kind: "advance" | "balance"; amount: string };

const REF_LABEL = {
  bank: "UTR / reference no.",
  upi: "UTR / reference no.",
  cash: "Slip / reference no.",
  cheque: "Cheque no.",
  diesel: "Slip no.",
} as const;

function startLine(c: PayableChallan, selected: boolean): Line {
  const kind = c.podReceived ? "balance" : "advance";
  return { selected, kind, amount: selected ? amountFor(kind, c) : "" };
}

/** Advance starts empty (the user types it); Balance is the full remaining amount. */
function amountFor(kind: Line["kind"], c: PayableChallan): string {
  return kind === "balance" ? fromPaise(c.roomPaise) : "";
}

/** Pay truck: payee → open challans with balance → amount per row, TDS, mode. Payments are optional. */
export function PayTruckForm({
  branches,
  pumps,
  today,
  defaultBranchId,
  initialPayee,
  initialChallans,
  initialChallanId,
}: {
  branches: { id: string; name: string }[];
  pumps: { id: string; name: string }[];
  today: string;
  defaultBranchId: string;
  initialPayee: PayeePick | null;
  initialChallans: PayableChallan[];
  initialChallanId: string | null;
}) {
  const router = useRouter();
  const [payee, setPayee] = useState<PayeePick | null>(initialPayee);
  const [challans, setChallans] = useState<PayableChallan[]>(initialChallans);
  const [lines, setLines] = useState<Record<string, Line>>(() =>
    Object.fromEntries(
      initialChallans.map((c) => [c.challanId, startLine(c, c.challanId === initialChallanId)]),
    ),
  );
  const [loadingChallans, setLoadingChallans] = useState(false);
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState<(typeof TRUCK_PAYMENT_MODES)[number]>("bank");
  const [refNo, setRefNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [pumpId, setPumpId] = useState("");
  const [upiId, setUpiId] = useState("");
  const [tdsPercent, setTdsPercent] = useState("0");
  const [narration, setNarration] = useState("");
  const [podReason, setPodReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pickPayee(p: PayeePick) {
    setPayee(p);
    setLoadingChallans(true);
    setErrors({});
    void payableChallansAction(p.id).then((list) => {
      setChallans(list);
      setLines(Object.fromEntries(list.map((c) => [c.challanId, startLine(c, false)])));
      setLoadingChallans(false);
    });
  }

  function patchLine(id: string, patch: Partial<Line>) {
    setLines((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));
  }

  const chosen = challans.filter((c) => lines[c.challanId]?.selected);
  const hasBalance = chosen.some((c) => lines[c.challanId].kind === "balance");
  const beforePod = chosen.filter((c) => lines[c.challanId].kind === "balance" && !c.podReceived);

  // Same pure maths the server runs, shown as a preview (the server stays the judge).
  const preview = (() => {
    const input = chosen.flatMap((c) => {
      const l = lines[c.challanId];
      const gross = /^\d{1,12}(\.\d{1,2})?$/.test(l.amount.trim()) ? toPaise(l.amount.trim()) : 0;
      return gross > 0
        ? [{ challanId: c.challanId, kind: l.kind, grossPaise: gross, tdsBasePaise: c.tdsBasePaise }]
        : [];
    });
    return calcTruckPayment(hasBalance ? tdsPercent || "0" : "0", input);
  })();

  // Yellow notes: never blockers (the server re-checks and stores its own warnings).
  const notes: string[] = [];
  if (payee && !payee.blacklisted && !payee.verified) notes.push("This payee is not verified yet.");
  if (payee?.blacklisted) notes.push("This payee is blacklisted — the server will not accept a payment.");
  if (payee && mode === "bank" && !payee.hasBankDetails)
    notes.push("The payee has no bank account / IFSC saved. Check the details before paying.");
  if (payee && mode === "upi" && !payee.hasUpi && !upiId.trim())
    notes.push("No UPI ID or QR is saved for this payee or typed here.");
  if (preview.tdsPaise > 0 && payee && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test((payee.pan ?? "").toUpperCase()))
    notes.push("TDS is being deducted but the payee has no valid PAN saved.");
  if (beforePod.length)
    notes.push(`POD is not received yet for ${beforePod.map((c) => c.challanNo).join(", ")}. Say why the balance is paid early.`);

  function build(confirmDuplicate: boolean): TruckPaymentInput | null {
    if (focusFirstInvalidDate()) return null;
    if (!payee) {
      setErrors({ payeePartyId: "Pick who is paid" });
      return null;
    }
    return {
      branchId,
      paidOn,
      payeePartyId: payee.id,
      mode,
      pumpId: mode === "diesel" ? pumpId : null,
      upiId: mode === "upi" ? upiId : null,
      refNo,
      chequeDate: mode === "cheque" ? chequeDate : null,
      tdsPercent: hasBalance ? tdsPercent : "0",
      narration,
      allocations: chosen.map((c) => ({
        challanId: c.challanId,
        kind: lines[c.challanId].kind,
        amount: lines[c.challanId].amount.trim(),
      })),
      confirmDuplicate,
      podOverrideReason: beforePod.length ? podReason : null,
    };
  }

  function save(confirmDuplicate = false) {
    const input = build(confirmDuplicate);
    if (!input) return;
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const r = await savePaymentAction(input);
      if (r.ok) {
        router.push(`/market-trucks/payments/${r.payment.id}`);
        return;
      }
      if (r.kind === "validation") {
        const dup = r.issues.find((i) => i.path === "confirmDuplicate");
        if (dup) {
          setDuplicate(dup.message);
          return;
        }
        const map: Record<string, string> = {};
        const idToLine = chosen.map((c) => c.challanId);
        for (const i of r.issues) {
          const m = /^allocations\.(\d+)\.(amount|kind|challanId)$/.exec(i.path);
          map[m ? `row.${idToLine[Number(m[1])]}` : i.path] = i.message;
        }
        setErrors(map);
        if (r.issues.some((i) => !i.path || i.path === "allocations")) setFormError(r.message);
      } else setFormError(r.message);
    });
  }

  const rowError = (id: string) => errors[`row.${id}`];

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-5"
    >
      <section className="rounded-card border border-border bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Combobox<PayeePick>
            label="Pay to"
            className="lg:col-span-2"
            selectedText={payee?.name ?? ""}
            listLabel="Truck owners and brokers"
            placeholder="Search owner or broker"
            loadOptions={searchPayeesAction}
            getKey={(p) => p.id}
            renderOption={(p) => (
              <span>
                {p.name}
                {p.mobile ? <span className="text-muted"> · {p.mobile}</span> : null}
              </span>
            )}
            onPick={pickPayee}
            error={errors.payeePartyId}
          />
          <DateField label="Payment date" value={paidOn} onChange={setPaidOn} required error={errors.paidOn} />
          <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} error={errors.branchId}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
      </section>

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="m-0 mb-3 text-[16px] font-bold">Challans with balance to pay</h2>
        {!payee ? (
          <p className="m-0 text-sm text-muted">Pick who is paid to see their open challans.</p>
        ) : loadingChallans ? (
          <p className="m-0 text-sm text-muted">Loading…</p>
        ) : challans.length === 0 ? (
          <p className="m-0 text-sm text-muted">{payee.name} has no challan with an amount left to pay.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[13px] text-muted">
                  <th className="border-b border-border py-2.5 pr-2 font-semibold">Pay</th>
                  <th className="border-b border-border py-2.5 pr-2 font-semibold">Challan</th>
                  <th className="border-b border-border py-2.5 pr-2 font-semibold">Route / truck</th>
                  <th className="border-b border-border py-2.5 pr-2 text-right font-semibold">Left to pay ₹</th>
                  <th className="border-b border-border py-2.5 pr-2 font-semibold">As</th>
                  <th className="border-b border-border py-2.5 font-semibold">Amount ₹</th>
                </tr>
              </thead>
              <tbody>
                {challans.map((c) => {
                  const l = lines[c.challanId];
                  return (
                    <tr key={c.challanId} className="align-top">
                      <td className="border-b border-border py-2.5 pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Pay challan ${c.challanNo}`}
                          checked={l.selected}
                          onChange={(e) =>
                            patchLine(c.challanId, {
                              selected: e.target.checked,
                              amount: e.target.checked && !l.amount ? amountFor(l.kind, c) : l.amount,
                            })
                          }
                          className="size-5"
                        />
                      </td>
                      <td className="border-b border-border py-2.5 pr-2">
                        <div className="font-mono">{c.challanNo}</div>
                        <div className="text-[13px] text-muted">
                          {formatDate(c.challanDate)} · {c.podReceived ? "POD received" : "POD pending"}
                        </div>
                      </td>
                      <td className="border-b border-border py-2.5 pr-2">
                        <div>{c.source || c.destination ? `${c.source ?? "—"} → ${c.destination ?? "—"}` : "—"}</div>
                        <div className="font-mono text-[13px] text-muted">{c.vehicleNo ?? ""}</div>
                      </td>
                      <td className="border-b border-border py-2.5 pr-2 text-right">
                        {formatPaise(c.roomPaise)}
                        <div className="text-[13px] text-muted">paid {formatPaise(c.paidPaise)}</div>
                      </td>
                      <td className="border-b border-border py-2.5 pr-2">
                        <Select
                          label="Paid as"
                          hideLabel
                          value={l.kind}
                          disabled={!l.selected}
                          onChange={(e) => {
                            const kind = e.target.value as Line["kind"];
                            patchLine(c.challanId, { kind, amount: amountFor(kind, c) });
                          }}
                        >
                          <option value="advance">Advance</option>
                          <option value="balance">Balance</option>
                        </Select>
                      </td>
                      <td className="border-b border-border py-2.5">
                        <Field
                          label="Amount"
                          hideLabel
                          inputMode="decimal"
                          value={l.amount}
                          disabled={!l.selected}
                          onChange={(e) => patchLine(c.challanId, { amount: e.target.value })}
                          error={rowError(c.challanId)}
                          autoComplete="off"
                        />
                        {l.selected && (
                          <button
                            type="button"
                            className="mt-1 text-[13px] underline"
                            onClick={() => patchLine(c.challanId, { amount: fromPaise(c.roomPaise) })}
                          >
                            Full amount
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {errors.allocations && <p className="mt-2 mb-0 text-[13px] text-danger">{errors.allocations}</p>}
      </section>

      <section className="rounded-card border border-border bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            label="Mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            error={errors.mode}
          >
            {TRUCK_PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {paymentModeLabel[m]}
              </option>
            ))}
          </Select>
          <Field
            label={REF_LABEL[mode]}
            value={refNo}
            onChange={(e) => setRefNo(e.target.value)}
            error={errors.refNo}
            hint={mode === "bank" || mode === "upi" ? "Can also be added when marking it paid." : undefined}
            autoComplete="off"
          />
          {mode === "cheque" && (
            <DateField label="Cheque date" value={chequeDate} onChange={setChequeDate} error={errors.chequeDate} />
          )}
          {mode === "diesel" && (
            <Select label="Pump" value={pumpId} onChange={(e) => setPumpId(e.target.value)} error={errors.pumpId}>
              <option value="">Select pump</option>
              {pumps.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
          {mode === "upi" && (
            <Field
              label="UPI ID (optional)"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              error={errors.upiId}
              hint="Left blank, the payee's saved UPI is used."
              autoComplete="off"
            />
          )}
          <Field
            label="TDS %"
            inputMode="decimal"
            value={hasBalance ? tdsPercent : "0"}
            disabled={!hasBalance}
            onChange={(e) => setTdsPercent(e.target.value)}
            error={errors.tdsPercent}
            hint={hasBalance ? "Deducted on the balance payment only. 0 = no TDS." : "TDS applies to a balance payment only."}
            autoComplete="off"
          />
        </div>
        {beforePod.length > 0 && (
          <Textarea
            label="Why is the balance paid before POD?"
            className="mt-4"
            value={podReason}
            onChange={(e) => setPodReason(e.target.value)}
            error={errors.podOverrideReason}
          />
        )}
        <Textarea
          label="Note (optional)"
          className="mt-4"
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          error={errors.narration}
        />
      </section>

      {notes.length > 0 && (
        <Alert tone="warning" title="Please check:">
          <ul className="m-0 mt-1 list-disc pl-5">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      )}
      {errors.confirmDuplicate && <p className="m-0 text-[13px] text-danger">{errors.confirmDuplicate}</p>}
      {formError && <p className="m-0 text-[13px] text-danger">{formError}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-5">
        <div className="text-sm">
          <div>
            Amount <b>₹{formatPaise(preview.grossPaise)}</b> · TDS <b>₹{formatPaise(preview.tdsPaise)}</b>
          </div>
          <div className="text-[16px]">
            Net to pay <b>₹{formatPaise(preview.netPaise)}</b>
          </div>
        </div>
        <div className="flex gap-3">
          <Button href="/market-trucks/payments" variant="secondary">
            Cancel
          </Button>
          <Button type="submit" disabled={pending || chosen.length === 0}>
            {pending ? "Saving…" : "Save payment"}
          </Button>
        </div>
      </div>

      <Dialog
        open={duplicate !== null}
        onClose={() => setDuplicate(null)}
        title="Looks like a repeat payment"
        description={duplicate}
      >
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDuplicate(null)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              setDuplicate(null);
              save(true);
            }}
          >
            Pay again
          </Button>
        </div>
      </Dialog>
    </form>
  );
}

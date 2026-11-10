"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  addTruckPartyAction,
  updateTruckPartyAction,
} from "@/app/(app)/market-trucks/parties/actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { useCan } from "@/components/ui/Permissions";
import type { TruckParty } from "@/lib/types";
import {
  truckPartyFields,
  type TruckPartyInput,
} from "@/lib/validators/truck-party";
import { TruckDocInput } from "./TruckDocInput";
import { truckPartyRoleLabel } from "./labels";

// Fields only payee.bank may change; booking staff see them read-only and the server rejects changes.
const BANK_KEYS = [
  "bankName",
  "accountHolder",
  "accountNo",
  "ifsc",
  "upiId",
  "upiQrUrl",
  "bankProofUrl",
  "verified",
  "status",
  "blacklistReason",
] as const;

/** An edit that names no bank field, so it can't touch them. */
function withoutBank(input: TruckPartyInput): TruckPartyInput {
  const o: Record<string, unknown> = { ...input };
  for (const k of BANK_KEYS) delete o[k];
  return o as TruckPartyInput;
}

/** Create (no `party`) or edit a truck party. Saves with its own buttons, then refreshes the list. */
export function TruckPartyForm({ party, onDone }: { party?: TruckParty; onDone: () => void }) {
  const router = useRouter();
  const canBank = useCan("payee.bank");
  const [qrUrl, setQrUrl] = useState<string | null>(party?.upiQrUrl ?? null);
  const [proofUrl, setProofUrl] = useState<string | null>(party?.bankProofUrl ?? null);
  const [pan, setPan] = useState(party?.pan ?? "");
  const [status, setStatus] = useState(party?.status ?? "active");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();
  const version = useRef(party?.version ?? 0);

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const get = (k: string) => String(data.get(k) ?? "");
    const input: TruckPartyInput = {
      role: get("role") as TruckPartyInput["role"],
      name: get("name"),
      mobile: get("mobile"),
      altMobile: get("altMobile"),
      pan: get("pan").toUpperCase(),
      gstin: get("gstin").toUpperCase(),
      address: get("address"),
      bankName: get("bankName"),
      accountHolder: get("accountHolder"),
      accountNo: get("accountNo"),
      ifsc: get("ifsc"),
      upiId: get("upiId"),
      upiQrUrl: qrUrl,
      bankProofUrl: proofUrl,
      verified: data.get("verified") === "on",
      status: get("status") as TruckPartyInput["status"],
      blacklistReason: get("blacklistReason"),
      notes: get("notes"),
    };
    const parsed = truckPartyFields.safeParse(input);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = party
        ? await updateTruckPartyAction(party.id, version.current, canBank ? input : withoutBank(input))
        : await addTruckPartyAction(input);
      if (result.ok) {
        version.current = result.party.version;
        router.refresh();
        onDone();
        return;
      }
      if (result.kind === "conflict") setConflict(true);
      else if (result.kind === "validation") {
        setErrors(Object.fromEntries(result.issues.map((i) => [i.path, i.message])));
        if (result.issues.some((i) => !i.path)) setFormError(result.message);
      } else setFormError(result.message);
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="grid grid-cols-2 gap-3"
    >
      {conflict && (
        <Alert tone="warning" className="col-span-2" title="This party was changed by someone else.">
          Close this and reopen it to see the latest details before saving again.
        </Alert>
      )}
      {party?.bankChangedAt && (
        <Alert tone="warning" className="col-span-2" title="Bank / UPI details were changed recently.">
          Confirm the new details with the owner before paying.
        </Alert>
      )}
      <Field label="Name" name="name" required defaultValue={party?.name ?? ""} error={errors.name} className="col-span-2" />
      <Select label="Role" name="role" defaultValue={party?.role ?? "owner"} error={errors.role} className="col-span-2 sm:col-span-1">
        {Object.entries(truckPartyRoleLabel).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      <Field label="Mobile" name="mobile" inputMode="tel" defaultValue={party?.mobile ?? ""} error={errors.mobile} className="col-span-2 sm:col-span-1" />
      <Field label="Alternate mobile" name="altMobile" inputMode="tel" defaultValue={party?.altMobile ?? ""} error={errors.altMobile} className="col-span-2 sm:col-span-1" />
      <Field label="PAN" name="pan" value={pan} onChange={(e) => setPan(e.target.value)} error={errors.pan} hint={party?.panType ? `PAN type: ${party.panType}` : undefined} className="col-span-2 sm:col-span-1 [&_input]:font-mono" />
      <Field
        label="GSTIN"
        name="gstin"
        defaultValue={party?.gstin ?? ""}
        onChange={(e) => {
          // PAN is characters 3–12 of a GSTIN; fill it only when empty, never over a typed PAN.
          const g = e.target.value.trim().toUpperCase();
          if (/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) setPan((p) => (p.trim() ? p : g.slice(2, 12)));
        }}
        error={errors.gstin}
        className="col-span-2 [&_input]:font-mono"
      />
      <Textarea label="Address" name="address" defaultValue={party?.address ?? ""} error={errors.address} className="col-span-2" />

      <Field label="Bank name" name="bankName" readOnly={!canBank} defaultValue={party?.bankName ?? ""} error={errors.bankName} className="col-span-2 sm:col-span-1" />
      <Field label="Account holder" name="accountHolder" readOnly={!canBank} defaultValue={party?.accountHolder ?? ""} error={errors.accountHolder} className="col-span-2 sm:col-span-1" />
      <Field label="Account number" name="accountNo" readOnly={!canBank} inputMode="numeric" defaultValue={party?.accountNo ?? ""} error={errors.accountNo} className="col-span-2 sm:col-span-1 [&_input]:font-mono" />
      <Field label="IFSC" name="ifsc" readOnly={!canBank} defaultValue={party?.ifsc ?? ""} error={errors.ifsc} className="col-span-2 sm:col-span-1 [&_input]:font-mono" />
      <Field label="UPI ID" name="upiId" readOnly={!canBank} defaultValue={party?.upiId ?? ""} error={errors.upiId} hint="e.g. name@bank" className="col-span-2 sm:col-span-1" />
      <div className="col-span-2 sm:col-span-1">
        {canBank ? (
          <TruckDocInput label="UPI QR image" kind="upi-qr" url={qrUrl} onChange={setQrUrl} error={errors.upiQrUrl} />
        ) : (
          <Field label="UPI QR image" readOnly value={qrUrl ? "Uploaded" : "Not added"} />
        )}
      </div>
      <div className="col-span-2 sm:col-span-1">
        {canBank ? (
          <TruckDocInput label="Bank proof (cancelled cheque / passbook)" kind="bank-proof" url={proofUrl} onChange={setProofUrl} error={errors.bankProofUrl} />
        ) : (
          <Field label="Bank proof" readOnly value={proofUrl ? "Uploaded" : "Not added"} />
        )}
      </div>
      {!canBank && (
        <p className="col-span-2 m-0 text-[13px] text-muted">
          Bank details, UPI, the verified flag and blacklisting can only be changed by an Owner or Accountant.
        </p>
      )}

      <label className="col-span-2 flex min-h-control items-center gap-2 text-sm font-semibold text-text">
        <input type="checkbox" name="verified" disabled={!canBank} defaultChecked={party?.verified ?? false} className="size-4" />
        Verified (KYC and bank details checked)
      </label>
      <Select label="Status" name="status" disabled={!canBank} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} error={errors.status} className="col-span-2 sm:col-span-1">
        <option value="active">Active</option>
        <option value="blacklisted">Blacklisted</option>
      </Select>
      {status === "blacklisted" && (
        <Field label="Blacklist reason" name="blacklistReason" required readOnly={!canBank} defaultValue={party?.blacklistReason ?? ""} error={errors.blacklistReason} className="col-span-2 sm:col-span-1" />
      )}
      <Textarea label="Notes" name="notes" defaultValue={party?.notes ?? ""} error={errors.notes} className="col-span-2" />

      {formError && <p className="col-span-2 m-0 text-[13px] text-danger">{formError}</p>}
      <div className="col-span-2 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : party ? "Save changes" : "Save truck party"}
        </Button>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { addPartyAction, gstinOwnerAction, updatePartyAction } from "@/app/(app)/parties/actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { chargedAsLabel, paymentModeLabel } from "@/lib/labels";
import type { Party } from "@/lib/types";
import { gstinError, normaliseGstin } from "@/lib/validators/common";
import { partyFields, type PartyInput } from "@/lib/validators/party";

export const PARTY_FORM_ID = "party-form";

/**
 * The last party saved here. The detail page keys this form by version, so the background
 * refresh after a save remounts it; this keeps "Saved" showing across that.
 */
let lastSaved: { id: string; version: number } | null = null;

/** What the page header shows about a party (refreshed after a save only when it changed). */
const headerOf = (p: Party) => [p.name, p.place, p.gstin, p.phone].join("|");

const gstPayerLabel = {
  consignor: "Consignor",
  consignee: "Consignee",
  transporter: "Transporter",
};

type Props =
  | { mode: "edit"; party: Party; onDone?: undefined }
  | { mode: "create"; party?: undefined; onDone?: () => void };

/**
 * Party details. "edit" saves with expectedVersion from the header's Save button (it submits this
 * form by id); "create" has its own Save button and opens the new party afterwards.
 */
export function PartyForm({ mode, party, onDone }: Props) {
  const router = useRouter();
  const [gstin, setGstin] = useState(party?.gstin ?? "");
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(
    () => !!party && lastSaved?.id === party.id && lastSaved.version === party.version,
  );
  const [pending, startTransition] = useTransition();
  const version = useRef(party?.version ?? 0);

  const normalised = normaliseGstin(gstin);
  const complete = normalised.length === 15 && gstinError(normalised) === null;
  const derivedPan = complete ? normalised.slice(2, 12) : "";
  const derivedState = complete ? normalised.slice(0, 2) : "";

  async function checkOwner() {
    setOwner(complete ? await gstinOwnerAction(normalised, party?.id) : null);
  }

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const get = (k: string) => String(data.get(k) ?? "");
    const input: PartyInput = {
      name: get("name"),
      place: get("place"),
      gstin: normalised,
      pan: derivedPan,
      phone: get("phone"),
      address: get("address"),
      stateCode: derivedState,
      pincode: get("pincode"),
      defaultFrom: get("defaultFrom"),
      defaultPaymentMode: (get("defaultPaymentMode") || null) as PartyInput["defaultPaymentMode"],
      defaultGstPayer: (get("defaultGstPayer") || null) as PartyInput["defaultGstPayer"],
      defaultChargedAs: (get("defaultChargedAs") || null) as PartyInput["defaultChargedAs"],
    };
    const parsed = partyFields.safeParse(input);
    setSaved(false);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result =
        mode === "create"
          ? await addPartyAction(input)
          : await updatePartyAction(party!.id, version.current, input);
      if (result.ok) {
        if ("party" in result) {
          version.current = result.party.version;
          lastSaved = { id: result.party.id, version: result.party.version };
          setSaved(true);
          // The header shows name, place, GSTIN and phone; re-read the page only if they changed.
          if (headerOf(result.party) !== headerOf(party!)) router.refresh();
        } else {
          onDone?.();
          router.push(`/parties/${result.id}`);
        }
        return;
      }
      if (result.kind === "conflict") setConflict(true);
      else if (result.kind === "validation") {
        setErrors(Object.fromEntries(result.issues.map((i) => [i.path, i.message])));
        if (result.issues.some((i) => !i.path)) setFormError(result.message);
      } else setFormError(result.message);
    });
  }

  const shownGstinError =
    errors.gstin ?? (normalised && !complete ? (gstinError(normalised) ?? undefined) : undefined);

  return (
    <form
      id={mode === "edit" ? PARTY_FORM_ID : undefined}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="grid grid-cols-2 gap-3"
    >
      {conflict && (
        <Alert
          tone="warning"
          className="col-span-2"
          title="This party was changed by someone else."
        >
          Reload to see the latest details before saving again.{" "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => router.refresh()}
          >
            Reload
          </button>
        </Alert>
      )}
      <Field
        label="Party name"
        name="name"
        required
        defaultValue={party?.name ?? ""}
        error={errors.name}
        className="col-span-2"
      />
      <Field
        label="Place"
        name="place"
        defaultValue={party?.place ?? ""}
        error={errors.place}
        className="col-span-2 sm:col-span-1"
      />
      <Field
        label="GSTIN"
        name="gstin"
        value={gstin}
        onChange={(e) => {
          setGstin(e.target.value.toUpperCase());
          setOwner(null);
        }}
        onBlur={checkOwner}
        autoComplete="off"
        error={shownGstinError}
        className="col-span-2 sm:col-span-1 [&_input]:font-mono"
      />
      {owner && (
        <Alert tone="warning" className="col-span-2" title="This GSTIN is already saved.">
          <Link href={`/parties/${owner.id}`}>{owner.name}</Link> uses it. Parties are unique by
          GSTIN, so it can&apos;t be saved twice — open the existing party instead.
        </Alert>
      )}
      {!normalised && (
        <Alert tone="warning" className="col-span-2" title="No GSTIN.">
          This party is saved as unregistered. Add the GSTIN later if they have one.
        </Alert>
      )}
      <Field
        label="PAN"
        value={derivedPan}
        readOnly
        disabled
        hint="From the GSTIN"
        className="col-span-1 [&_input]:font-mono"
      />
      <Field
        label="State code"
        value={derivedState}
        readOnly
        disabled
        hint="From the GSTIN"
        className="col-span-1 [&_input]:font-mono"
      />
      <Field
        label="Phone"
        name="phone"
        inputMode="tel"
        defaultValue={party?.phone ?? ""}
        error={errors.phone}
        className="col-span-2 sm:col-span-1"
      />
      <Field
        label="Pincode"
        name="pincode"
        inputMode="numeric"
        defaultValue={party?.pincode ?? ""}
        error={errors.pincode}
        className="col-span-2 sm:col-span-1"
      />
      <Textarea
        label="Address"
        name="address"
        defaultValue={party?.address ?? ""}
        error={errors.address}
        className="col-span-2"
      />
      <Field
        label="Default from"
        name="defaultFrom"
        defaultValue={party?.defaultFrom ?? ""}
        error={errors.defaultFrom}
        className="col-span-2 sm:col-span-1"
      />
      <Select
        label="Default payment"
        name="defaultPaymentMode"
        defaultValue={party?.defaultPaymentMode ?? ""}
        error={errors.defaultPaymentMode}
        className="col-span-2 sm:col-span-1"
      >
        <option value="">—</option>
        {Object.entries(paymentModeLabel).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      <Select
        label="GST paid by"
        name="defaultGstPayer"
        defaultValue={party?.defaultGstPayer ?? ""}
        error={errors.defaultGstPayer}
        className="col-span-2 sm:col-span-1"
      >
        <option value="">—</option>
        {Object.entries(gstPayerLabel).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      <Select
        label="Charged as"
        name="defaultChargedAs"
        defaultValue={party?.defaultChargedAs ?? ""}
        error={errors.defaultChargedAs}
        className="col-span-2 sm:col-span-1"
      >
        <option value="">—</option>
        {Object.entries(chargedAsLabel).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      {formError && <p className="col-span-2 m-0 text-[13px] text-danger">{formError}</p>}
      {mode === "edit" && (
        <p role="status" className="col-span-2 m-0 min-h-5 text-[13px] text-muted">
          {pending ? "Saving…" : saved ? "Saved. New LRs and invoices will use these details." : ""}
        </p>
      )}
      {mode === "create" && (
        <div className="col-span-2 flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save party"}
          </Button>
        </div>
      )}
    </form>
  );
}

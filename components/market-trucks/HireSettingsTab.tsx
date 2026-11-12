"use client";

// Settings tab of /market-trucks/masters: every Tier-1 company setting in one form (Owner only).
// Empty = not configured. Percentages are 0–100; amounts are in rupees.
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { updateHireSettingsAction } from "@/app/(app)/market-trucks/masters/actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field, Select } from "@/components/ui/Field";
import {
  SHORTAGE_RATE_SOURCES,
  TDS_BASES,
  TDS_TIMINGS,
  type HireSettings,
} from "@/lib/validators/hire-settings";

const str = (d: FormData, k: string) => String(d.get(k) ?? "").trim();
const num = (d: FormData, k: string) => {
  const s = str(d, k);
  return s === "" ? null : Number(s);
};
const txt = (d: FormData, k: string) => str(d, k) || null;

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

export function HireSettingsTab({ settings }: { settings: HireSettings }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const version = useRef(settings.version);
  const [shortageAuto, setShortageAuto] = useState(settings.shortageAuto);

  const n = (v: number | null) => (v === null ? "" : String(v));
  const numberField = (
    name: keyof HireSettings,
    label: string,
    hint: string,
    opts: { step?: string; required?: boolean } = {},
  ) => (
    <Field
      key={name}
      name={name}
      label={label}
      hint={hint}
      type="number"
      inputMode="decimal"
      step={opts.step ?? "any"}
      min={0}
      defaultValue={n(settings[name] as number | null)}
      error={errors[name]}
    />
  );

  function submit(form: HTMLFormElement) {
    const d = new FormData(form);
    setErrors({});
    setFormError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateHireSettingsAction(version.current, {
        minMarginPct: num(d, "minMarginPct"),
        rateOutlierPct: num(d, "rateOutlierPct"),
        tdsSectionLabel: txt(d, "tdsSectionLabel"),
        tdsRateIndividualPct: num(d, "tdsRateIndividualPct"),
        tdsRateOtherPct: num(d, "tdsRateOtherPct"),
        tdsRateNoPanPct: num(d, "tdsRateNoPanPct"),
        tdsThreshold: num(d, "tdsThreshold"),
        tdsNilMaxVehicles: num(d, "tdsNilMaxVehicles"),
        tdsTiming: str(d, "tdsTiming") as never,
        tdsBase: str(d, "tdsBase") as never,
        shortageAuto,
        shortageAllowancePct: num(d, "shortageAllowancePct"),
        shortageRateSource: txt(d, "shortageRateSource") as never,
        detentionFreeDays: num(d, "detentionFreeDays"),
        detentionRatePerDay: num(d, "detentionRatePerDay"),
        latePodDays: num(d, "latePodDays"),
        latePodFee: num(d, "latePodFee"),
        cashWarningLimit: num(d, "cashWarningLimit"),
        makerCheckerLimit: num(d, "makerCheckerLimit"),
        bankChangeCoolingHours: num(d, "bankChangeCoolingHours"),
        ewbAlertHours: num(d, "ewbAlertHours"),
        ewbKmPerDay: num(d, "ewbKmPerDay") as number,
        ewbOdcKmPerDay: num(d, "ewbOdcKmPerDay") as number,
      });
      if (result.ok) {
        version.current = result.row.version;
        setSaved(true);
        router.refresh();
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
      className="flex flex-col gap-4"
    >
      {conflict && (
        <Alert tone="warning" title="These settings were changed by someone else.">
          Reload this page to see the latest values before saving again.
        </Alert>
      )}

      <Card title="Margin & rates" description="Warnings shown on the challan form. Leave blank to switch a check off.">
        <Grid>
          {numberField("minMarginPct", "Minimum margin (%)", "Warn when party rate minus truck rate is below this share.")}
          {numberField("rateOutlierPct", "Rate outlier (%)", "Warn when a truck rate differs from the usual rate on the lane by more than this.")}
        </Grid>
      </Card>

      <Card title="TDS" description="Starts at 0% and is always typed by hand; these are only the hints shown next to it.">
        <Grid>
          <Field name="tdsSectionLabel" label="Section label" hint="Printed on payments, e.g. 194C." defaultValue={settings.tdsSectionLabel ?? ""} error={errors.tdsSectionLabel} />
          {numberField("tdsRateIndividualPct", "Rate: individual / HUF (%)", "Suggested when the owner is an individual with PAN.")}
          {numberField("tdsRateOtherPct", "Rate: others (%)", "Suggested for firms and companies with PAN.")}
          {numberField("tdsRateNoPanPct", "Rate: no PAN (%)", "Suggested when the party has no PAN on file.")}
          {numberField("tdsThreshold", "Yearly threshold (₹)", "TDS is suggested only once a party's yearly payments cross this.")}
          {numberField("tdsNilMaxVehicles", "Nil-TDS max vehicles", "Owners with at most this many vehicles can give a no-TDS declaration.", { step: "1" })}
          <Select name="tdsTiming" label="When TDS is deducted" hint="Decided: at balance, not on advances." defaultValue="balance" error={errors.tdsTiming}>
            {TDS_TIMINGS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select name="tdsBase" label="TDS is calculated on" hint="The amount the rate is applied to." defaultValue={settings.tdsBase} error={errors.tdsBase}>
            {TDS_BASES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Grid>
      </Card>

      <Card title="Shortage, detention & late POD" description="Defaults filled into the POD screen; each can be edited per challan.">
        <Grid>
          <div className="md:col-span-2">
            <Checkbox checked={shortageAuto} onChange={setShortageAuto}>
              Auto shortage — deduct missing goods from the truck at POD settlement
            </Checkbox>
            <p className="m-0 text-[13px] text-muted">
              Off: shortage is not deducted automatically; add a POD charge by hand if needed.
            </p>
          </div>
          {numberField("shortageAllowancePct", "Shortage allowance (%)", "Weight loss allowed before a shortage is charged.")}
          <Select name="shortageRateSource" label="Shortage is charged at" hint="Which rate values the missing goods." defaultValue={settings.shortageRateSource ?? ""} error={errors.shortageRateSource}>
            <option value="">Not set</option>
            {SHORTAGE_RATE_SOURCES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          {numberField("detentionFreeDays", "Detention free days", "Days a truck can wait before detention starts.", { step: "1" })}
          {numberField("detentionRatePerDay", "Detention rate per day (₹)", "Suggested rate once free days are over.")}
          {numberField("latePodDays", "Late POD after (days)", "Late POD fee applies when POD arrives after this many days.", { step: "1" })}
          {numberField("latePodFee", "Late POD fee (₹)", "Deducted from the truck's balance for late POD.")}
        </Grid>
      </Card>

      <Card title="Payments & approval" description="Controls on what can be paid and who approves it.">
        <Grid>
          {numberField("cashWarningLimit", "Cash warning limit (₹)", "Warn when a cash payment goes above this. Blank = no warning.")}
          {numberField("makerCheckerLimit", "Owner approval above (₹)", "Payments above this wait for the Owner. 0 = all payments; blank = approval off.")}
          {numberField("bankChangeCoolingHours", "Bank-detail cooling (hours)", "Hold payments to a party for this long after its bank details change.", { step: "1" })}
        </Grid>
      </Card>

      <Card title="E-way bill" description="Used to work out when an e-way bill expires.">
        <Grid>
          {numberField("ewbAlertHours", "Alert before expiry (hours)", "Dashboard alert starts this long before the e-way bill runs out.", { step: "1" })}
          {numberField("ewbKmPerDay", "Distance per day (km)", "Normal cargo; the standard rule is 200 km per day.", { step: "1" })}
          {numberField("ewbOdcKmPerDay", "Distance per day, ODC (km)", "Over-dimensional cargo; the standard rule is 20 km per day.", { step: "1" })}
        </Grid>
      </Card>

      {formError && <p className="m-0 text-[13px] text-danger">{formError}</p>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saved && <span className="text-[13px] text-success">Settings saved.</span>}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}

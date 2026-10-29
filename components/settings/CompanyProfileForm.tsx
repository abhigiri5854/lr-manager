"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { saveCompanyAction } from "@/app/(app)/settings/company/actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import type { NumberingState } from "@/lib/data/companies";
import {
  formFromCompany,
  patchFromForm,
  sampleFreightBillNo,
  sampleLrNo,
  sampleTaxInvoiceNo,
  validateForm,
  type CompanyForm,
} from "@/lib/company-form";
import { formatGstRate } from "@/lib/gst";
import type { Company } from "@/lib/types";
import { FREIGHT_GST_RATES_BP, ifscBankWarning, LR_COPY_OPTIONS } from "@/lib/validators/company";
import { INVOICE_NO_MAX } from "@/lib/validators/invoice";
import { AddCompanyButton } from "./AddCompanyDialog";
import { CompanyImages } from "./CompanyImages";
import { CompanyPreview, WhereDataAppears } from "./CompanyPreview";

const FORM_ID = "company-profile";

type Errors = Record<string, string>;

/** Company profile (Settings.dc.html): edits the company chosen in "Working as". */
export function CompanyProfileForm({
  company,
  numbering,
  canEdit,
  today,
}: {
  company: Company;
  numbering: NumberingState;
  canEdit: boolean;
  /** dd-mm-yyyy, for the preview. */
  today: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<CompanyForm>(() => formFromCompany(company));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const version = useRef(company.version);

  const set = <K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };
  /** Props for a text input bound to a form key. */
  const bind = (key: keyof CompanyForm, errorPath: string = key) => ({
    name: key,
    value: form[key] as string,
    onChange: (e: { target: { value: string } }) => {
      set(key, e.target.value as never);
      // The red message goes once the field is touched; Save checks everything again.
      if (errors[errorPath]) {
        setErrors((all) => {
          const rest = { ...all };
          delete rest[errorPath];
          return rest;
        });
      }
    },
    error: errors[errorPath],
  });

  const fbCounter = form.numberingResetsYearly
    ? numbering.freightBill.ifReset
    : numbering.freightBill.ifRunOn;
  const tiCounter = form.numberingResetsYearly
    ? numbering.taxInvoice.ifReset
    : numbering.taxInvoice.ifRunOn;
  const lrSample = sampleLrNo(form, numbering.lr);
  const fbSample = sampleFreightBillNo(form.freightBillPrefix, fbCounter);
  const tiSample = sampleTaxInvoiceNo(form.taxInvoicePrefix, tiCounter);
  const ifscWarning = errors["bank.ifsc"] ? null : ifscBankWarning(form.bankName, form.ifsc);

  function save() {
    setSaved(false);
    setFormError(null);
    const issues = validateForm(form, numbering.lr);
    if (issues.length) {
      setErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
      setFormError("Some details need fixing — see the fields marked in red.");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const r = await saveCompanyAction(company.id, version.current, patchFromForm(form));
      if (r.ok) {
        version.current = r.company.version;
        setConflict(null);
        setSaved(true);
        // The sidebar and LR numbering read the profile too; they catch up in the background.
        router.refresh();
        return;
      }
      if (r.kind === "conflict") setConflict(r.message);
      else if (r.kind === "validation") {
        setErrors(Object.fromEntries(r.issues.map((i) => [i.path, i.message])));
        setFormError(
          r.issues.some((i) => !i.path)
            ? r.message
            : "Some details need fixing — see the fields marked in red.",
        );
      } else setFormError(r.message);
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="SETTINGS"
        title="Company profile"
        subtitle="One place for your company details. Every new LR, tax invoice, POD and freight invoice picks them up automatically."
        actions={
          <>
            <Button variant="secondary" href="#live-preview">
              Preview PDF
            </Button>
            {canEdit && (
              <Button type="submit" form={FORM_ID} variant="dark" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            )}
          </>
        }
      />

      <Alert tone="info" className="-mt-1" action={canEdit ? <AddCompanyButton /> : undefined}>
        Editing <b className="text-primary">{company.label}</b> — the company chosen in “Working
        as”. Switch there to edit another.
      </Alert>

      {!canEdit && (
        <Alert tone="warning" title="View only.">
          Only the company Owner can change these details.
        </Alert>
      )}
      {conflict && (
        <Alert tone="warning" title="Not saved.">
          {conflict}{" "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => router.refresh()}
          >
            Reload
          </button>
        </Alert>
      )}
      {(formError || saved) && (
        <p
          role={formError ? "alert" : "status"}
          className={formError ? "m-0 text-sm text-danger" : "m-0 text-sm text-success"}
        >
          {formError ?? "Saved. New documents will use these details."}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <form
          id={FORM_ID}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (canEdit) save();
          }}
          className="min-w-0 flex-[999_1_560px]"
        >
          <fieldset disabled={!canEdit} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
            <Card title="Company information">
              <Grid>
                <Field label="Company name (printed)" {...bind("name")} />
                <Field
                  label="Short name (Working as)"
                  hint="Shown in the company switcher"
                  {...bind("label")}
                />
                <Textarea label="Registered office" {...bind("office")} />
                <Field label="City" {...bind("city")} />
                <Field label="Email ID" type="email" inputMode="email" {...bind("email")} />
                <Field label="Website" inputMode="url" {...bind("website")} />
                <Field label="Mobile no. 1" type="tel" inputMode="tel" {...bind("mobile1")} />
                <Field label="Mobile no. 2" type="tel" inputMode="tel" {...bind("mobile2")} />
              </Grid>
            </Card>

            <Card title="Tax & registration">
              <Grid cols={3}>
                <Field
                  label="GSTIN"
                  autoCapitalize="characters"
                  className="[&_input]:font-mono"
                  {...bind("gstin")}
                />
                <Field
                  label="PAN no."
                  autoCapitalize="characters"
                  className="[&_input]:font-mono"
                  {...bind("pan")}
                />
                <Field
                  label="MSME / UDYAM no."
                  placeholder="UDYAM-XX-00-0000000"
                  autoCapitalize="characters"
                  className="[&_input]:font-mono"
                  {...bind("udyam")}
                />
              </Grid>
              <p className="mt-2.5 mb-0 text-[13px] text-muted">
                PAN is checked against GSTIN characters 3–12; state code (first 2 digits) sets
                SGST+CGST vs IGST.
              </p>
            </Card>

            <Card title="Bank account details">
              <Grid>
                <Field
                  label="Account name"
                  placeholder="Not set"
                  {...bind("accountName", "bank.accountName")}
                />
                <Field
                  label="Bank name"
                  placeholder="Not set"
                  {...bind("bankName", "bank.bankName")}
                />
                <Field
                  label="Account number"
                  placeholder="Not set"
                  inputMode="numeric"
                  className="[&_input]:font-mono"
                  {...bind("accountNo", "bank.accountNo")}
                />
                <Field
                  label="NEFT IFSC code"
                  placeholder="Not set"
                  autoCapitalize="characters"
                  className="[&_input]:font-mono"
                  aiFlag={ifscWarning ? "low-confidence" : undefined}
                  aiNote={ifscWarning}
                  {...bind("ifsc", "bank.ifsc")}
                />
              </Grid>
              {errors.bank && <p className="mt-2.5 mb-0 text-[13px] text-danger">{errors.bank}</p>}
            </Card>

            <Card
              title="Numbering"
              description={`Numbers are given when a document is saved (LR) or finalised (bills, invoices). Samples are for FY ${numbering.fy}.`}
            >
              <Grid>
                <Field
                  label="LR number prefix"
                  placeholder="none"
                  autoCapitalize="characters"
                  className="[&_input]:font-mono"
                  {...bind("lrPrefix")}
                />
                <Field
                  label="Next LR number"
                  placeholder="e.g. 1"
                  inputMode="numeric"
                  className="[&_input]:font-mono"
                  hint={
                    numbering.lr !== null
                      ? `Can only be raised (lowest: ${numbering.lr}).`
                      : "Set where your LR book starts."
                  }
                  {...bind("nextLrNo")}
                />
                <Field
                  label="Freight bill prefix"
                  placeholder="none"
                  autoCapitalize="characters"
                  className="[&_input]:font-mono"
                  {...bind("freightBillPrefix")}
                />
                <Field
                  label="Tax invoice prefix"
                  placeholder="none"
                  autoCapitalize="characters"
                  className="[&_input]:font-mono"
                  hint={`Whole number at most ${INVOICE_NO_MAX} characters.`}
                  {...bind("taxInvoicePrefix")}
                />
              </Grid>
              <dl className="mt-4 mb-0 grid grid-cols-1 gap-3 rounded-tile bg-surface-muted p-3 text-sm sm:grid-cols-3">
                <Sample label="Next LR" value={lrSample ?? "not set"} />
                <Sample label="Next freight bill" value={fbSample} />
                <Sample label="Next tax invoice" value={tiSample ?? "prefix too long"} />
              </dl>
              <Checkbox
                className="mt-3"
                checked={form.numberingResetsYearly}
                onChange={(v) => set("numberingResetsYearly", v)}
              >
                Reset freight bill and tax invoice numbers to 001 each financial year (LR numbers
                always run on)
              </Checkbox>
            </Card>

            <Card title="Invoice & document defaults">
              <Grid>
                <Field label="Invoice title / label" {...bind("invoiceTitle")} />
                <Field label="Default invoice note" {...bind("invoiceNote")} />
                <Field
                  label="Authorised signatory"
                  placeholder="Name on PDFs"
                  {...bind("signatoryName")}
                />
                <Select label="GST on forward-charge freight bills" {...bind("freightGstRateBp")}>
                  {FREIGHT_GST_RATES_BP.map((bp) => (
                    <option key={bp} value={bp}>
                      {formatGstRate(bp)}
                    </option>
                  ))}
                </Select>
              </Grid>
              <Checkbox
                className="mt-3"
                checked={form.invoiceRoundOff}
                onChange={(v) => set("invoiceRoundOff", v)}
              >
                Round tax invoice totals to the nearest rupee (shown as a Round off line)
              </Checkbox>
            </Card>

            <Card
              title="LR terms"
              description="Printed on this company’s LRs and used for its alerts and penalties — nothing is hard-coded."
            >
              <Grid cols={3}>
                <Field label="Jurisdiction" placeholder="City" {...bind("jurisdiction")} />
                <Field
                  label="POD due within (days)"
                  placeholder="days"
                  inputMode="numeric"
                  {...bind("podDays")}
                />
                <Field
                  label="Late POD penalty (₹ / day)"
                  placeholder="0"
                  inputMode="decimal"
                  {...bind("podPenalty", "podPenaltyPerDay")}
                />
                <Field
                  label="Detention charges"
                  placeholder="e.g. 7 MT ₹1,000/day"
                  className="sm:col-span-3"
                  {...bind("detention")}
                />
                <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-3">
                  <legend className="mb-1.5 p-0 text-[13px] font-semibold text-label">
                    LR copies printed
                  </legend>
                  <div className="flex flex-wrap gap-x-5">
                    {LR_COPY_OPTIONS.map((copy) => (
                      <Checkbox
                        key={copy}
                        checked={form.lrCopies.includes(copy)}
                        onChange={(on) =>
                          set(
                            "lrCopies",
                            LR_COPY_OPTIONS.filter((c) =>
                              c === copy ? on : form.lrCopies.includes(c),
                            ),
                          )
                        }
                      >
                        {copy}
                      </Checkbox>
                    ))}
                  </div>
                  {errors.lrCopies && (
                    <div className="mt-1.5 text-[13px] text-danger">{errors.lrCopies}</div>
                  )}
                </fieldset>
                <Textarea
                  label="Terms printed on LR"
                  placeholder="Your conditions of carriage"
                  className="sm:col-span-3"
                  {...bind("lrTerms")}
                />
              </Grid>
            </Card>

            <CompanyImages
              companyId={company.id}
              companyName={form.name}
              logoUrl={form.logoUrl}
              signatureUrl={form.signatureUrl}
              useLogoWatermark={form.useLogoWatermark}
              errors={errors}
              onChange={(patch) => {
                setForm((f) => ({ ...f, ...patch }));
                setSaved(false);
              }}
            />
          </fieldset>
        </form>

        <aside className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
          <CompanyPreview form={form} invoiceNo={fbSample} today={today} />
          <WhereDataAppears />
        </aside>
      </div>
    </>
  );
}

function Grid({ cols = 2, children }: { cols?: 2 | 3; children: ReactNode }) {
  return (
    <div
      className={
        cols === 3
          ? "grid grid-cols-1 gap-4 sm:grid-cols-3"
          : "grid grid-cols-1 gap-4 sm:grid-cols-2"
      }
    >
      {children}
    </div>
  );
}

function Sample({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="m-0 truncate font-mono font-medium" aria-live="polite">
        {value}
      </dd>
    </div>
  );
}

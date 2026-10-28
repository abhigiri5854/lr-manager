import { bankLine, contactLine, lrTermsLine, taxLine, type CompanyForm } from "@/lib/company-form";
import { Card } from "@/components/ui/Card";

const row = "relative border-b border-border-print px-2.5 py-1.5";

/** Live freight-invoice header, from the unsaved form (Settings.dc.html right column). */
export function CompanyPreview({
  form,
  invoiceNo,
  today,
}: {
  form: CompanyForm;
  invoiceNo: string;
  today: string;
}) {
  const logo = form.logoUrl;
  return (
    <section
      id="live-preview"
      aria-label="Live preview"
      className="scroll-mt-4 rounded-card border border-border bg-surface p-4"
    >
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="m-0 text-[17px] font-bold">Live preview</h2>
        <span className="text-xs text-muted">updates as you type</span>
      </div>
      <div className="relative overflow-hidden border-[1.5px] border-navy bg-surface text-xs leading-normal">
        {logo && form.useLogoWatermark && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute top-[52%] left-1/2 w-[260px] -translate-x-1/2 -translate-y-1/2 opacity-[0.07]"
          />
        )}
        <div className="relative flex items-center gap-3 border-b border-border-print px-3 py-2.5">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-11 max-w-[120px] object-contain" />
          )}
          <div className="min-w-0 flex-1 text-center text-[18px] font-bold break-words">
            {form.name || "Company name"}
          </div>
        </div>
        <div className={`${row} text-center break-words`}>
          {form.office || "Registered office"}
          {contactLine(form) && (
            <>
              <br />
              {contactLine(form)}
            </>
          )}
        </div>
        <div className={`${row} text-center`}>{taxLine(form)}</div>
        <div className={`${row} text-center text-sm font-bold`}>{form.invoiceTitle}</div>
        <div className={`${row} flex justify-between gap-2 font-semibold`}>
          <span className="min-w-0 break-all">Invoice No: {invoiceNo}</span>
          <span className="shrink-0">Date: {today}</span>
        </div>
        <div className={`${row} py-4.5 text-center text-muted`}>… bill-to, LR table, totals …</div>
        <div className="relative px-2.5 py-1.5 break-words">
          {form.invoiceNote && (
            <>
              Note: {form.invoiceNote}
              <br />
            </>
          )}
          <b>Bank:</b> {bankLine(form)}
          <br />
          <b>LR terms:</b> {lrTermsLine(form)}
        </div>
      </div>
    </section>
  );
}

export function WhereDataAppears() {
  return (
    <Card title="Where this data appears" className="text-sm leading-relaxed">
      <div className="-mt-1.5">
        <div>
          <b>Freight invoice</b> — logo, watermark, header, bank, note, prefix
        </div>
        <div>
          <b>LR / consignment note</b> — logo, address, GSTIN, PAN
        </div>
        <div>
          <b>POD receipt</b> — logo, header, signatory
        </div>
        <div>
          <b>Tax invoice</b> — transporter name &amp; GSTIN
        </div>
        <div>
          <b>Emails / WhatsApp</b> — name, phone, email
        </div>
        <p className="mt-2.5 mb-0 text-[13px] text-muted">
          New documents use the latest profile. Already-finalised ones keep their saved snapshot
          unless you click “Refresh company details” on that document.
        </p>
      </div>
    </Card>
  );
}

// Freight bill PDF (design/screens/FreightPDF.dc.html): landscape A4, one row per LR.
// The title ("FREIGHT INVOICE"), bank details, GST note and jurisdiction are the company's.
import { amountInWords, formatDate, formatPaise } from "@/lib/format";
import { stateLabel } from "@/lib/gst";
import { chargedAsLabel } from "@/lib/labels";
import { lrTotalWeight } from "@/lib/lr-charges";
import type { LrView, PartySnapshot } from "@/lib/types";
import type { BillPdfData } from "../load";
import {
  addressLine,
  bold,
  brLines,
  columns,
  esc,
  htmlDocument,
  join,
  multiline,
  orDash,
  registrations,
  section,
  signatureBlock,
} from "./shared";

function partiesBlock(list: PartySnapshot[], withDetails: boolean): string {
  if (list.length === 0) return "—";
  return list
    .map((p) =>
      brLines([
        bold(join([p.name, p.place], ", ")),
        withDetails && p.address && esc(p.address),
        withDetails && p.phone && `Phone: ${esc(p.phone)}`,
        p.gstin && `GSTIN: ${esc(p.gstin)}`,
      ]),
    )
    .join('<div style="height:6px"></div>');
}

function description(lr: LrView): string {
  const goods = lr.items
    .map((i) => i.description)
    .filter(Boolean)
    .join(", ");
  return join([goods && esc(goods), `${lr.totalPackages} pkgs`], ", ");
}

const GST_LABEL = { sgst: "SGST", cgst: "CGST", igst: "IGST" } as const;

export function billHtml(d: BillPdfData): string {
  const { bill, company, party } = d;
  const t = bill.totals;
  const sum = (pick: (l: BillPdfData["rows"][number]["line"]) => number) =>
    d.rows.reduce((s, r) => s + pick(r.line), 0);

  const rows = d.rows
    .map(({ line, lr }, i) => {
      const invoices = lr ? lr.lrInvoices.map((x) => x.invoiceNo).join(", ") : "";
      return `<tr><td class="c">${i + 1}</td><td>${orDash(lr?.lrNo)}</td><td>${lr?.lrDate ? formatDate(lr.lrDate) : "—"}</td><td>${orDash(invoices)}</td><td>${
        lr ? description(lr) : "—"
      }</td><td>${orDash(lr?.fromPlace)}</td><td>${orDash(lr?.toPlace)}</td><td>${orDash(lr?.truckNumber)}</td><td>${
        lr?.chargedAs ? esc(chargedAsLabel[lr.chargedAs]) : "—"
      }</td><td class="r">${lr ? esc(lrTotalWeight(lr.items) ?? "") : ""}</td><td class="r">${
        lr?.ratePaise != null ? formatPaise(lr.ratePaise) : ""
      }</td><td class="r">${formatPaise(line.freightPaise)}</td><td class="r">${formatPaise(line.detentionPaise)}</td><td class="r">${formatPaise(line.otherPaise)}</td><td class="r">${formatPaise(line.totalPaise)}</td></tr>`;
    })
    .join("");

  const COLS = 15;
  const strong = "font-weight:700";
  const totalRow = `<tr><td colspan="11" class="c" style="${strong}">TOTAL</td><td class="r" style="${strong}">${formatPaise(sum((l) => l.freightPaise))}</td><td class="r" style="${strong}">${formatPaise(sum((l) => l.detentionPaise))}</td><td class="r" style="${strong}">${formatPaise(sum((l) => l.otherPaise))}</td><td class="r" style="${strong}">${formatPaise(t.chargesPaise)}</td></tr>`;
  const extra = (label: string, value: string, bolder = false) =>
    `<tr><td colspan="${COLS - 1}" class="r"${bolder ? ` style="${strong}"` : ""}>${label}</td><td class="r"${bolder ? ` style="${strong}"` : ""}>${value}</td></tr>`;
  const taxRows = (["sgst", "cgst", "igst"] as const)
    .filter((k) => t[`${k}Paise`] > 0)
    .map((k) => extra(`${GST_LABEL[k]} @ ${bill.gstRateBp / 100 / (k === "igst" ? 1 : 2)}%`, formatPaise(t[`${k}Paise`])))
    .join("");
  const advanceRow = t.advancePaise > 0 ? extra("Less: advance paid", formatPaise(t.advancePaise)) : "";
  const showNet = taxRows !== "" || advanceRow !== "";
  const netRow = showNet ? extra("Net amount payable", formatPaise(t.amountPaise), true) : "";

  const gstNote =
    bill.gstMode === "reverse_charge"
      ? "Note: GST on freight under reverse charge (RCM) — payable by recipient."
      : `Note: GST charged on freight at ${bill.gstRateBp / 100}%${
          party.stateCode ? ` · Place of supply ${stateLabel(party.stateCode)}` : ""
        }.`;
  const bank = company.bank;

  const body = `<div class="frame">
<div class="lh" style="padding:14px 18px;gap:24px">
<div>${
    company.logoSrc
      ? `<img src="${company.logoSrc}" alt="${esc(company.name)}" style="height:52px;max-width:320px;object-fit:contain">`
      : `<div class="co-name">${esc(company.name)}</div>`
  }</div>
<div class="r"><div style="font-size:22px;font-weight:700;letter-spacing:.08em;color:var(--primary)">${esc(company.invoiceTitle)}</div><div style="font-size:13px;margin-top:2px">Original for recipient</div></div>
</div>
<div class="addr" style="padding:8px 18px;line-height:1.55">${addressLine(company)}<br>${registrations(company).replace(/<br>/g, " · ")}</div>
<div class="bar" style="padding:8px 18px;font-size:15px;font-weight:700"><span>Invoice No: <span class="mono">${esc(bill.billNo ?? "(draft)")}</span></span><span>Invoice Date: ${formatDate(bill.billDate)}</span></div>
${columns([
  section("BILLED TO", partiesBlock([party], true)),
  section("SHIP FROM", partiesBlock(d.shipFrom, false)),
  section("SHIP TO", partiesBlock(d.shipTo, true)),
])}
<table class="tbl"><thead><tr><th class="c">S No</th><th>LR No</th><th>LR Date</th><th>Invoice No</th><th>Description</th><th>From</th><th>Destination</th><th>Vehicle No</th><th>Vehicle Type</th><th class="r">Billing Wt</th><th class="r">Rate</th><th class="r">Freight</th><th class="r">Detention</th><th class="r">Other</th><th class="r">Total Freight</th></tr></thead>
<tbody>${rows}${totalRow}${taxRows}${advanceRow}${netRow}
<tr><td colspan="${COLS}" style="font-weight:600">Amount in words: ${esc(amountInWords(Math.max(0, t.amountPaise)))}</td></tr></tbody></table>
<div class="grow" style="display:flex;border-top:1px solid var(--rule);margin-top:-1px;break-inside:avoid">
<div style="flex:1;padding:10px 14px;line-height:1.7;border-right:1px solid var(--rule)">
<div>${esc(gstNote)}</div>${company.invoiceNote ? `<div>${multiline(company.invoiceNote)}</div>` : ""}${
    bank
      ? `<div style="font-weight:700;margin-top:6px;color:var(--navy)">Our bank account details</div>
<div>A/c name: ${esc(bank.accountName)} · Bank: ${esc(bank.bankName)}</div>
<div>A/c no: ${esc(bank.accountNo)} · IFSC: ${esc(bank.ifsc)}</div>`
      : ""
  }</div>
<div style="width:300px;padding:10px 14px;display:flex;flex-direction:column;justify-content:flex-end">${signatureBlock(company, "Authorised signatory")}</div>
</div>
<div class="foot" style="padding:6px 14px">Computer-generated invoice${
    company.jurisdiction ? ` · Subject to ${esc(company.jurisdiction)} jurisdiction` : ""
  }</div>
</div>`;

  return htmlDocument({
    title: `Freight bill ${bill.billNo ?? "(draft)"} – ${company.name}`,
    landscape: true,
    watermarkSrc: company.useLogoWatermark ? company.logoSrc : null,
    mark: d.mark,
    body,
  });
}

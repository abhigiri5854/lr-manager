// LR PDF (design/screens/LRPDF.dc.html): one A4 page per copy — Consignor, Consignee, Driver,
// Office (the company's "LR copies printed" list).
import { formatDate, formatPaise, formatRupeesShort } from "@/lib/format";
import { chargedAsLabel } from "@/lib/labels";
import { lrTotalWeight } from "@/lib/lr-charges";
import type { GstPayer, LrPaymentMode, LrView, Paise, PartySnapshot } from "@/lib/types";
import type { LrPdfData } from "../load";
import {
  bold,
  brLines,
  columns,
  esc,
  htmlDocument,
  join,
  letterhead,
  multiline,
  orDash,
  section,
  signatureBlock,
} from "./shared";

const PAYMENT_LABEL: Record<LrPaymentMode, string> = {
  tbb: "T.B.B. (to be billed)",
  to_pay: "To pay",
  paid: "Paid",
};

const GST_PAYER_LABEL: Record<GstPayer, string> = {
  consignor: "Paid by consignor",
  consignee: "Paid by consignee",
  transporter: "",
};

/** Shown when the company has not listed its copies in Company profile. */
const DEFAULT_COPIES = ["Consignor", "Consignee", "Driver", "Office"];

function partyBlock(p: PartySnapshot | null): string {
  if (!p) return "—";
  return brLines([
    bold(join([p.name, p.place], ", ")),
    p.address && esc(p.address),
    join([p.gstin && `GSTIN ${esc(p.gstin)}`, p.phone && `Ph ${esc(p.phone)}`], " · "),
  ]);
}

const money = (paise: Paise | null) =>
  paise === null ? '<span class="blank"></span>' : formatPaise(paise);

function chargeRows(lr: LrView): string {
  const c = lr.charges;
  const loadUnload =
    c.loading === null && c.unloading === null ? null : (c.loading ?? 0) + (c.unloading ?? 0);
  const entered = [c.freight, c.packing, c.cnCharge, loadUnload, c.detention, c.other];
  const transporterGst = lr.gstPaidBy === "transporter";
  const total = entered.reduce<number>((s, v) => s + (v ?? 0), 0) + (transporterGst ? (c.gst ?? 0) : 0);
  const anyEntered = entered.some((v) => v !== null) || (transporterGst && c.gst !== null);
  const advance = c.advance;
  const balance = anyEntered || advance !== null ? total - (advance ?? 0) : null;
  const row = (label: string, value: string, strong = false) =>
    `<tr><td>${strong ? `<b>${label}</b>` : label}</td><td class="r">${strong ? `<b>${value}</b>` : value}</td></tr>`;
  const gst = lr.gstPaidBy
    ? transporterGst
      ? money(c.gst)
      : esc(GST_PAYER_LABEL[lr.gstPaidBy])
    : "—";
  return [
    row("Freight", money(c.freight)),
    row("Packing charge", money(c.packing)),
    row("C.N. charge", money(c.cnCharge)),
    row("Loading / unloading", money(loadUnload)),
    c.detention !== null ? row("Detention", money(c.detention)) : "",
    c.other !== null ? row("Other", money(c.other)) : "",
    row("GST", gst),
    row("Grand total", anyEntered ? formatPaise(total) : money(null), true),
    row(
      "Advance / balance",
      `${money(advance)} / ${balance === null ? money(null) : formatPaise(balance)}`,
    ),
  ].join("");
}

function itemsTable(lr: LrView): string {
  const many = lr.items.length > 1;
  const value = lr.totalValuePaise;
  const charged = lr.chargedAs
    ? join(
        [
          chargedAsLabel[lr.chargedAs],
          lr.chargedAs !== "ftl" && lr.ratePaise !== null ? `@ ₹${formatPaise(lr.ratePaise)}` : "",
        ],
        " ",
      )
    : "—";
  const rows = lr.items
    .map((it, i) => {
      const weight = it.chargedWeight ?? it.actualWeight;
      return `<tr><td>${it.packages}</td><td>${orDash(it.description)}</td><td>${esc(
        join([it.size, weight], " · ") || "—",
      )}</td><td>${i === 0 ? esc(charged) : ""}</td><td class="r">${
        !many && i === 0 && value !== null ? formatPaise(value) : ""
      }</td></tr>`;
    })
    .join("");
  const totalRow = many
    ? `<tr><td><b>${lr.totalPackages}</b></td><td><b>Total</b></td><td><b>${esc(
        lrTotalWeight(lr.items) ?? "",
      )}</b></td><td></td><td class="r"><b>${value !== null ? formatPaise(value) : ""}</b></td></tr>`
    : "";
  return `<table class="tbl"><thead><tr><th style="width:70px">Packages</th><th>Description (said to contain)</th><th style="width:130px">Weight &amp; size</th><th style="width:100px">Charged</th><th class="r" style="width:100px">Value ₹</th></tr></thead><tbody>${rows}${totalRow}</tbody></table>`;
}

function documentsBlock(lr: LrView): string {
  if (lr.lrInvoices.length === 0) return "—";
  return lr.lrInvoices
    .map((i) =>
      brLines([
        join([`Invoice ${esc(i.invoiceNo)}`, i.invoiceDate && formatDate(i.invoiceDate)], " · "),
        i.ewayBillNo && `E-way bill ${esc(i.ewayBillNo)}`,
        i.ewayExpiresAt && `E-way expiry ${formatDate(i.ewayExpiresAt)}`,
      ]),
    )
    .join('<div style="height:4px"></div>');
}

function terms(d: LrPdfData): string {
  const c = d.company;
  const pod =
    c.podDays !== null
      ? `<b>POD:</b> send within ${c.podDays} days of delivery${
          c.podPenaltyPerDay ? `, else ${formatRupeesShort(c.podPenaltyPerDay)}/day penalty is deducted` : ""
        }.`
      : "";
  return brLines([
    d.lr.paymentMode && `<b>Payment:</b> ${esc(PAYMENT_LABEL[d.lr.paymentMode])}`,
    c.detention && `<b>Detention:</b> ${esc(c.detention)}`,
    pod,
    d.lr.remarks && `<b>Remarks:</b> ${multiline(d.lr.remarks)}`,
    c.lrTerms && multiline(c.lrTerms),
  ]);
}

function copyPage(d: LrPdfData, copy: string, copies: string[]): string {
  const { lr, company } = d;
  const risk = lr.risk === "carrier" ? "At carrier’s risk" : "At owner’s risk";
  const driver = lr.driverMobile ? `Driver ${esc(lr.driverMobile)}` : "";
  return `<section class="copy"><div class="frame">
${letterhead(company)}
<div class="bar"><div class="title">CONSIGNMENT NOTE</div>
<div class="r"><b>${esc(copy.toUpperCase())} COPY</b> · ${risk}${
    company.jurisdiction ? `<br>Subject to ${esc(company.jurisdiction)} jurisdiction` : ""
  }</div></div>
${columns([
  `<div class="sec">LR No<br><b style="font-size:16px">${esc(lr.lrNo)}</b></div>`,
  `<div class="sec">LR date<br><b style="font-size:14px">${lr.lrDate ? formatDate(lr.lrDate) : "—"}</b></div>`,
  `<div class="sec">From<br><b style="font-size:14px">${esc(lr.fromPlace?.toUpperCase() ?? "—")}</b></div>`,
  `<div class="sec">To<br><b style="font-size:14px">${esc(lr.toPlace?.toUpperCase() ?? "—")}</b></div>`,
])}
${columns([section("CONSIGNOR", partyBlock(d.consignor)), section("CONSIGNEE", partyBlock(d.consignee))])}
${columns([
  section(
    "BILLED TO",
    d.billedTo
      ? brLines([bold(join([d.billedTo.name, d.billedTo.place], ", ")), d.billedTo.gstin && `GSTIN ${esc(d.billedTo.gstin)}`])
      : "Same as consignee",
  ),
  section("DOCUMENTS", documentsBlock(lr)),
  section("VEHICLE", brLines([`Truck ${orDash(lr.truckNumber)}`, driver])),
])}
${itemsTable(lr)}
<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid var(--rule);margin-top:-1px;break-inside:avoid">
<table><tbody>${chargeRows(lr)}</tbody></table>
<div style="padding:10px 12px;line-height:1.6;border-left:1px solid var(--rule)">${terms(d)}</div>
</div>
<div class="grow"></div>
<div class="sigrow"><div>Signature of consignor</div><div>Received by (consignee)</div><div>${signatureBlock(company, "Booking office")}</div></div>
<div class="foot">Copies: ${esc(copies.join(" · "))}</div>
</div></section>`;
}

export function lrHtml(d: LrPdfData): string {
  const copies = d.company.lrCopies.length > 0 ? d.company.lrCopies : DEFAULT_COPIES;
  return htmlDocument({
    title: `LR ${d.lr.lrNo} – ${d.company.name}`,
    watermarkSrc: d.company.useLogoWatermark ? d.company.logoSrc : null,
    mark: d.mark,
    body: copies.map((c) => copyPage(d, c, copies)).join("\n"),
  });
}

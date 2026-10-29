// Tax invoice PDF (design/screens/InvoicePDF.dc.html). The header is the seller's: this company
// for its own invoices, the selling party for imported ones (with that party's logo and
// watermark when it has one).
import { amountInWords, formatDate, formatPaise } from "@/lib/format";
import { formatGstRate, stateLabel } from "@/lib/gst";
import type { PartySnapshot, TaxInvoiceLine } from "@/lib/types";
import type { InvoicePdfData } from "../load";
import { qrSvg } from "../qr-svg";
import {
  bold,
  brLines,
  columns,
  esc,
  htmlDocument,
  join,
  multiline,
  orDash,
  section,
} from "./shared";

/** "2026-10-10T06:27:00.000Z" → "10-10-2026 11:57" in India time. */
function formatDateTimeIst(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("day")}-${p("month")}-${p("year")} ${p("hour")}:${p("minute")}`;
}

function partyBlock(p: PartySnapshot, extra?: string): string {
  return brLines([
    bold(join([p.name, p.place], " | ")),
    p.address && esc(p.address),
    join([p.pincode && esc(p.pincode), p.phone && esc(p.phone)], " | "),
    join([p.gstin && `GSTIN ${esc(p.gstin)}`, extra], " | "),
  ]);
}

const qtyText = (q: string) => String(Number(q));

/** IRN and the e-invoice QR, when the invoice was imported with them. Nothing is printed without a payload. */
function eInvoiceRow(inv: InvoicePdfData["invoice"]): string {
  const qr = inv.qrPayload ? qrSvg(inv.qrPayload, 104) : "";
  if (!inv.irn && !qr) return "";
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:6px 16px;border-bottom:1px solid var(--rule);break-inside:avoid">
<div style="overflow-wrap:anywhere">${inv.irn ? `IRN: ${esc(inv.irn)}` : ""}${qr ? `<br><span style="color:var(--muted)">E-invoice QR</span>` : ""}</div>${qr}</div>`;
}

function linesTable(d: InvoicePdfData): string {
  const { lines, totals } = d.invoice;
  const igst = totals.igstPaise > 0 || lines.some((l) => l.igstPaise > 0);
  const discount = lines.some((l) => l.discountPaise > 0);
  const taxCols = igst ? ["IGST"] : ["SGST", "CGST"];
  const rateOf = (l: TaxInvoiceLine) => (igst ? l.gstRateBp : l.gstRateBp / 2);
  const taxCell = (l: TaxInvoiceLine, which: string) => {
    const amount = which === "IGST" ? l.igstPaise : which === "SGST" ? l.sgstPaise : l.cgstPaise;
    return `<td class="r">${formatPaise(amount)}<br><span style="color:var(--muted)">${formatGstRate(rateOf(l))}</span></td>`;
  };
  const head = `<tr><th>#</th><th>Code</th><th>Description</th><th>HSN</th><th>UOM</th><th class="r">Qty</th><th class="r">Rate</th>${
    discount ? '<th class="r">Disc.</th>' : ""
  }<th class="r">Taxable</th>${taxCols.map((t) => `<th class="r">${t}</th>`).join("")}</tr>`;
  const rows = lines
    .map(
      (l, i) =>
        `<tr><td>${i + 1}</td><td>${orDash(l.itemCode)}</td><td>${esc(l.description)}</td><td>${orDash(l.hsn)}</td><td>${orDash(l.uom)}</td><td class="r">${qtyText(l.qty)}</td><td class="r">${formatPaise(l.ratePaise)}</td>${
          discount ? `<td class="r">${formatPaise(l.discountPaise)}</td>` : ""
        }<td class="r">${formatPaise(l.taxablePaise)}</td>${taxCols.map((t) => taxCell(l, t)).join("")}</tr>`,
    )
    .join("");
  const span = discount ? 8 : 7;
  const taxTotal = (t: string) =>
    formatPaise(t === "IGST" ? totals.igstPaise : t === "SGST" ? totals.sgstPaise : totals.cgstPaise);
  const total = `<tr><td colspan="${span}" class="r"><b>Total</b></td><td class="r"><b>${formatPaise(totals.taxablePaise)}</b></td>${taxCols
    .map((t) => `<td class="r"><b>${taxTotal(t)}</b></td>`)
    .join("")}</tr>`;
  const cols = span + 1 + taxCols.length;
  const roundOff =
    totals.roundOffPaise !== 0
      ? `<tr><td colspan="${cols - 1}" class="r">Round off</td><td class="r">${totals.roundOffPaise < 0 ? "-" : ""}${formatPaise(Math.abs(totals.roundOffPaise))}</td></tr>`
      : "";
  return `<table class="tbl"><thead>${head}</thead><tbody>${rows}${total}${roundOff}</tbody></table>`;
}

export function invoiceHtml(d: InvoicePdfData): string {
  const { invoice: inv, seller, company } = d;
  const refs = [
    inv.soNo && `SO ${esc(inv.soNo)}${inv.soDate ? ` · ${formatDate(inv.soDate)}` : ""}`,
    inv.doNo && `DO ${esc(inv.doNo)}`,
    inv.sapRef && `SAP ${esc(inv.sapRef)}`,
    inv.customerRef &&
      `Customer ref ${esc(inv.customerRef)}${inv.customerRefDate ? ` · ${formatDate(inv.customerRefDate)}` : ""}`,
  ];
  const transport = [
    join([inv.transporterName && esc(inv.transporterName), d.truckNumber && esc(d.truckNumber)], " · "),
    join(
      [
        inv.driverMobile && `Driver ${esc(inv.driverMobile)}`,
        d.lrNos.length > 0 && `LR ${esc(d.lrNos.join(", "))}`,
      ],
      " · ",
    ),
    inv.shipFrom && `Ship from ${esc(inv.shipFrom)}`,
    inv.incoterm && esc(inv.incoterm),
    inv.ewayBillNo && `E-way bill ${esc(inv.ewayBillNo)}`,
  ];
  const bank = company?.bank;
  const billToExtra = `Place of supply ${esc(stateLabel(inv.placeOfSupplyStateCode))}`;
  const copyLabel = seller.own ? "Original for recipient" : "Duplicate for transporter";
  const note = seller.own ? company?.invoiceNote : null;

  const body = `<div class="frame">
<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 16px;border-bottom:1px solid var(--rule)">
${seller.logoSrc ? `<img src="${seller.logoSrc}" alt="" style="height:52px;max-width:160px;object-fit:contain">` : ""}
<div style="flex:1;line-height:1.5"><b style="font-size:15px">${esc(seller.name)}</b>${
    seller.address ? `<br>${esc(seller.address)}` : ""
  }<br>${join(
    [seller.gstin && `GSTIN <b>${esc(seller.gstin)}</b>`, seller.pan && `PAN ${esc(seller.pan)}`, seller.phone && `Ph ${esc(seller.phone)}`],
    " · ",
  )}</div></div>
<div class="bar"><div class="title" style="color:var(--text)">TAX INVOICE</div><div><b>${copyLabel}</b></div></div>
${eInvoiceRow(inv)}
${columns([
  section(
    "INVOICE",
    brLines([
      `No <b>${esc(inv.invoiceNo ?? "(draft)")}</b> · ${formatDateTimeIst(inv.invoiceAt)}`,
      join(refs.slice(0, 3), " · "),
      refs[3],
    ]),
  ),
  section("TRANSPORT", brLines(transport) || "—"),
])}
${columns([
  section("BILL TO", partyBlock(d.billTo, billToExtra)),
  section("SHIP TO", d.shipTo ? partyBlock(d.shipTo) : "Same as bill to"),
])}
${linesTable(d)}
<div style="display:flex;justify-content:space-between;gap:16px;padding:10px 16px;border-top:1px solid var(--rule);margin-top:-1px;break-inside:avoid">
<div style="line-height:1.6">Amount in words: ${esc(amountInWords(inv.totals.totalPaise))}</div>
<div class="r" style="white-space:nowrap;font-size:15px"><b>Invoice total ₹ ${formatPaise(inv.totals.totalPaise)}</b></div></div>
${
  bank || note
    ? `<div style="padding:8px 16px;border-top:1px solid var(--rule);line-height:1.6;break-inside:avoid">${brLines([
        note && multiline(note),
        bank && `<b>Bank:</b> ${esc(bank.accountName)} · ${esc(bank.bankName)} · A/c ${esc(bank.accountNo)} · IFSC ${esc(bank.ifsc)}`,
      ])}</div>`
    : ""
}
<div class="grow"></div>
<div class="sign" style="padding:36px 16px 10px;border-top:1px solid var(--rule);break-inside:avoid">${
    company?.signatureSrc ? `<img src="${company.signatureSrc}" alt="" style="height:44px;max-width:180px;object-fit:contain"><br>` : ""
  }<b>For ${esc(seller.name)}</b><br>${
    company?.signatoryName ? `${esc(company.signatoryName)}<br>` : ""
  }Authorised signatory</div>
</div>`;

  return htmlDocument({
    title: `Tax invoice ${inv.invoiceNo ?? "(draft)"}`,
    // Own invoices follow the company's watermark switch; a selling party's logo is always used.
    watermarkSrc: seller.own ? (company?.useLogoWatermark ? seller.logoSrc : null) : seller.logoSrc,
    mark: d.mark,
    body,
  });
}

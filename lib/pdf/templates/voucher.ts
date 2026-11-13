// Truck payment voucher PDF: same design language as the challan PDF (letterhead, tinted section
// bars, ruled tables, signature row). One A4 page. Payee details are the snapshot frozen at approval.
import { amountInWords, formatDate, formatPaise, formatPercent } from "@/lib/format";
import { toPaise } from "@/lib/hire";
import type { PaymentPdfData } from "../load";
import {
  bold,
  brLines,
  columns,
  esc,
  htmlDocument,
  letterhead,
  orDash,
  section,
  signatureBlock,
} from "./shared";

const money = (rupees: string) => formatPaise(toPaise(rupees));
const MODE = { bank: "Bank transfer", upi: "UPI", cash: "Cash", cheque: "Cheque", diesel: "Diesel (pump)" } as const;
const KIND = { advance: "Advance", balance: "Balance" } as const;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function allocationTable(d: PaymentPdfData): string {
  const p = d.payment;
  const rows = p.allocations
    .map((a) => {
      const gross = toPaise(a.amount) + toPaise(a.tdsAmount);
      const tds = toPaise(a.tdsAmount) > 0 ? formatPaise(toPaise(a.tdsAmount)) : "—";
      return `<tr><td class="mono">${esc(a.challanNo)}</td><td>${KIND[a.kind]}</td><td class="r">${formatPaise(gross)}</td><td class="r">${tds}</td><td class="r">${money(a.amount)}</td></tr>`;
    })
    .join("");
  const totalTds = toPaise(p.tdsAmount) > 0 ? money(p.tdsAmount) : "—";
  const total = `<tr><td colspan="2"><b>Total</b></td><td class="r"><b>${money(p.grossAmount)}</b></td><td class="r"><b>${totalTds}</b></td><td class="r"><b>${money(p.amount)}</b></td></tr>`;
  return `<table class="tbl"><thead><tr><th style="width:140px">Challan no.</th><th>Paid as</th><th class="r" style="width:110px">Amount ₹</th><th class="r" style="width:100px">TDS ₹</th><th class="r" style="width:120px">Net paid ₹</th></tr></thead><tbody>${
    rows || '<tr><td colspan="5">No challans.</td></tr>'
  }${rows ? total : ""}</tbody></table>`;
}

export function paymentHtml(d: PaymentPdfData): string {
  const { payment: p, company } = d;
  const snap = p.payeeSnapshot ?? {};
  const acct = str(snap.accountNo);
  const bankLine =
    p.mode === "bank" && (str(snap.bankName) || acct)
      ? `${esc(str(snap.bankName) ?? "Bank")}${acct ? ` · A/c <span class="mono">••••${esc(acct.slice(-4))}</span>` : ""}${
          str(snap.ifsc) ? ` · IFSC <span class="mono">${esc(str(snap.ifsc))}</span>` : ""
        }`
      : "";
  const upi = p.upiId ?? str(snap.upiId);
  const body = `<section class="copy"><div class="frame">
${letterhead(company)}
<div class="bar"><div class="title">PAYMENT VOUCHER</div>
<div class="r"><b>${esc(d.branchName ?? "—")}</b> branch</div></div>
${columns([
  `<div class="sec">Voucher no.<br><b class="mono" style="font-size:16px">${esc(p.paymentNo ?? "Not approved yet")}</b></div>`,
  `<div class="sec">Date<br><b style="font-size:14px">${formatDate(p.paidOn)}</b></div>`,
  `<div class="sec">Mode<br><b style="font-size:14px">${MODE[p.mode]}</b></div>`,
  `<div class="sec">${p.mode === "cheque" ? "Cheque no." : "Reference / UTR"}<br><b class="mono" style="font-size:14px">${orDash(p.refNo)}</b></div>`,
])}
${columns([
  section(
    "PAID TO",
    brLines([
      bold(str(snap.name) ?? p.payeeName ?? "—"),
      str(snap.mobile) && `Mob. ${esc(str(snap.mobile))}`,
      str(snap.pan) && `PAN <span class="mono">${esc(str(snap.pan))}</span>`,
      str(snap.address) && esc(str(snap.address)),
    ]),
  ),
  section(
    "PAYMENT DETAILS",
    brLines([
      bankLine,
      p.mode === "upi" && upi && `UPI <span class="mono">${esc(upi)}</span>`,
      p.mode === "cheque" && p.chequeDate && `Cheque date ${formatDate(p.chequeDate)}`,
      p.mode === "diesel" && d.pumpName && `Pump ${esc(d.pumpName)}`,
      p.narration && `Note: ${esc(p.narration)}`,
    ]),
  ),
])}
${allocationTable(d)}
<div style="padding:10px 12px;border-top:1px solid var(--rule);margin-top:-1px;line-height:1.7;break-inside:avoid">
<b>Net paid: ₹${money(p.amount)}</b>${toPaise(p.tdsAmount) > 0 ? ` (after TDS ₹${money(p.tdsAmount)} at ${esc(formatPercent(p.tdsPercent))}% on balance)` : ""}<br>
<span style="color:var(--muted)">${esc(amountInWords(toPaise(p.amount)))}</span>
</div>
<div class="grow"></div>
<div class="sigrow"><div>Received by (payee signature)</div><div>Prepared by</div><div>${signatureBlock(company, "Authorised signatory")}</div></div>
</div></section>`;
  return htmlDocument({
    title: `Voucher ${p.paymentNo ?? "draft"} – ${company.name}`,
    watermarkSrc: company.useLogoWatermark ? company.logoSrc : null,
    mark: d.mark,
    body,
  });
}

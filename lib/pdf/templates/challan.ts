// Lorry hire challan PDF: same design language as the LR PDF (letterhead, tinted section bars,
// ruled tables, signature row). One A4 page. Party freight is deliberately not printed: the
// challan goes to the truck owner / driver.
import { formatDate, formatPaise } from "@/lib/format";
import { toPaise } from "@/lib/hire";
import type { ChallanPdfData } from "../load";
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

const money = (rupees: string) => formatPaise(toPaise(rupees));

const BASIS_LABEL = { trip: "per trip", per_tonne: "per tonne" } as const;
const PAYEE_LABEL = { owner: "Truck owner", broker: "Broker" } as const;

function lrTable(d: ChallanPdfData): string {
  const pick = new Map(d.lrs.map((p) => [p.lrId, p]));
  let pkgs = 0;
  let kg = 0;
  const rows = d.challan.lrs
    .map((l) => {
      const p = pick.get(l.lrId);
      pkgs += l.loadedPkgs;
      kg += Number(l.loadedWt ?? 0);
      return `<tr><td class="mono">${esc(l.lrNo)}</td><td>${p?.lrDate ? formatDate(p.lrDate) : "—"}</td><td>${orDash(
        p?.consignorName,
      )}</td><td>${orDash(p?.consigneeName)}</td><td>${
        join([p?.fromPlace, p?.toPlace].map((x) => (x ? esc(x) : "")), " → ") || "—"
      }</td><td class="r">${l.loadedPkgs}</td><td class="r">${l.loadedWt ? esc(l.loadedWt) : "—"}</td></tr>`;
    })
    .join("");
  const total = `<tr><td colspan="5"><b>Total</b></td><td class="r"><b>${pkgs}</b></td><td class="r"><b>${
    kg > 0 ? kg.toFixed(3) : "—"
  }</b></td></tr>`;
  return `<table class="tbl"><thead><tr><th style="width:90px">LR no.</th><th style="width:80px">LR date</th><th>Consignor</th><th>Consignee</th><th style="width:140px">Route</th><th class="r" style="width:60px">Pkgs</th><th class="r" style="width:80px">Weight kg</th></tr></thead><tbody>${
    rows || '<tr><td colspan="7">No LRs on this challan.</td></tr>'
  }${rows ? total : ""}</tbody></table>`;
}

function hireRows(d: ChallanPdfData): string {
  const { challan: c, extras: x } = d;
  const m = x.money;
  const row = (label: string, value: string, strong = false) =>
    `<tr><td>${strong ? `<b>${label}</b>` : label}</td><td class="r">${strong ? `<b>${value}</b>` : value}</td></tr>`;
  const basis =
    c.rateBasis === "per_tonne"
      ? `Hire (₹${money(c.rate)} per tonne × ${esc(c.qtyTonnes ?? "0")} t)`
      : `Hire (₹${money(c.rate)} ${BASIS_LABEL[c.rateBasis]})`;
  const charges = c.charges.map((g) =>
    row(
      `${g.direction === "add" ? "Add" : "Less"}: ${esc(g.label)}${g.note ? ` <span style="color:var(--muted)">(${esc(g.note)})</span>` : ""}`,
      `${g.direction === "add" ? "" : "−"}${money(g.amount)}`,
    ),
  );
  const advance = toPaise(m.advancePaid);
  const balancePaid = toPaise(m.paid) - advance;
  return [
    row(basis, money(c.hireAmount)),
    ...charges,
    row("Gross hire", money(m.grossCredit), true),
    toPaise(m.deductions) > 0 ? row("Less: deductions", `−${money(m.deductions)}`) : "",
    toPaise(m.tds) > 0 ? row("Less: TDS", `−${money(m.tds)}`) : "",
    row("Net payable", money(m.netPayable), true),
    row("Advance paid", formatPaise(advance)),
    balancePaid > 0 ? row("Balance paid", formatPaise(balancePaid)) : "",
    row("Balance to pay", money(m.balance), true),
  ].join("");
}

export function challanHtml(d: ChallanPdfData): string {
  const { challan: c, extras: x, company } = d;
  const body = `<section class="copy"><div class="frame">
${letterhead(company)}
<div class="bar"><div class="title">LORRY HIRE CHALLAN</div>
<div class="r"><b>${esc(c.branchName)}</b> branch</div></div>
${columns([
  `<div class="sec">Challan no.<br><b class="mono" style="font-size:16px">${esc(c.challanNo)}</b></div>`,
  `<div class="sec">Date<br><b style="font-size:14px">${formatDate(c.challanDate)}</b></div>`,
  `<div class="sec">From<br><b style="font-size:14px">${esc(c.source?.toUpperCase() ?? "—")}</b></div>`,
  `<div class="sec">To<br><b style="font-size:14px">${esc(c.destination?.toUpperCase() ?? "—")}</b></div>`,
])}
${columns([
  section(
    "VEHICLE & DRIVER",
    brLines([
      `Truck <b class="mono">${orDash(c.vehicleNo)}</b>`,
      x.vehicleTypeName && esc(x.vehicleTypeName),
      `Driver ${orDash(c.driverName)}${x.driverMobile ? ` · ${esc(x.driverMobile)}` : ""}`,
      x.driverDlNo && `Licence <span class="mono">${esc(x.driverDlNo)}</span>`,
    ]),
  ),
  section(
    "HIRE PAID TO",
    brLines([
      bold(c.payeeName ?? "—"),
      esc(PAYEE_LABEL[c.payeeKind]),
      x.payeeMobile && `Mob. ${esc(x.payeeMobile)}`,
      x.payeePan && `PAN <span class="mono">${esc(x.payeePan)}</span>`,
      c.payeeKind === "owner" && c.brokerName && `Broker ${esc(c.brokerName)}`,
    ]),
  ),
])}
${lrTable(d)}
<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid var(--rule);margin-top:-1px;break-inside:avoid">
<table><tbody>${hireRows(d)}</tbody></table>
<div style="padding:10px 12px;line-height:1.6;border-left:1px solid var(--rule)">${
    c.remarks ? `<b>Remarks:</b> ${multiline(c.remarks)}` : ""
  }</div>
</div>
<div class="grow"></div>
<div class="sigrow"><div>Driver signature</div><div>${esc(PAYEE_LABEL[c.payeeKind])} signature</div><div>${signatureBlock(company, "Authorised signatory")}</div></div>
</div></section>`;
  return htmlDocument({
    title: `Challan ${c.challanNo} – ${company.name}`,
    watermarkSrc: company.useLogoWatermark ? company.logoSrc : null,
    mark: d.mark,
    body,
  });
}

// POD receipt PDF (design/screens/PODPDF.dc.html): delivery details plus the signed LR copy.
import { formatDate, formatRupeesShort } from "@/lib/format";
import type { PodCondition } from "@/lib/types";
import type { PodPdfData } from "../load";
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

const CONDITION_LABEL: Record<PodCondition, string> = {
  good: "Good",
  short: "Short",
  damaged: "Damaged",
};

function copiesBox(d: PodPdfData): string {
  const photos = d.copies.filter((c) => c.src);
  const files = d.copies.filter((c) => !c.src);
  const tall = photos.length === 1 ? "150mm" : "72mm";
  const images = photos
    .map(
      (c) =>
        `<img src="${c.src}" alt="${esc(c.name)}" style="max-width:100%;max-height:${tall};object-fit:contain;break-inside:avoid">`,
    )
    .join("");
  const names = files.length
    ? `<div style="color:var(--muted)">Also uploaded (not shown here): ${esc(files.map((f) => f.name).join(", "))}</div>`
    : "";
  const empty =
    photos.length === 0
      ? `<div style="flex:1;border:1px dashed var(--rule);display:flex;align-items:center;justify-content:center;color:var(--muted);min-height:60mm">No signed copy uploaded yet</div>`
      : "";
  return `<div style="padding:12px;border-right:1px solid var(--rule);display:flex;flex-direction:column;gap:8px"><b>Signed &amp; stamped LR copy</b>${images}${empty}${names}</div>`;
}

export function podHtml(d: PodPdfData): string {
  const { lr, pod, company } = d;
  const route = join([lr.fromPlace, lr.toPlace], " to ");
  const documents = lr.lrInvoices
    .map((i) => join([`Invoice ${esc(i.invoiceNo)}`, i.ewayBillNo && `E-way ${esc(i.ewayBillNo)}`], " · "))
    .join("<br>");
  const goods = lr.items
    .map((i) => i.description)
    .filter(Boolean)
    .join(", ");
  const receiver = join([pod.receivedBy && esc(pod.receivedBy), pod.receiverPhone && esc(pod.receiverPhone)], " · ");
  const rules =
    company.podDays !== null
      ? `POD due within ${company.podDays} days of delivery${
          company.podPenaltyPerDay
            ? ` · late POD ${formatRupeesShort(company.podPenaltyPerDay)}/day as per LR terms`
            : ""
        }`
      : "";

  const body = `<div class="frame">
${letterhead(company)}
<div class="bar"><div class="title">PROOF OF DELIVERY</div>${
    pod.receivedAt ? `<div>Signed copy received on <b>${formatDate(pod.receivedAt)}</b></div>` : ""
  }</div>
${columns([
  section(
    "CONSIGNMENT",
    brLines([
      `LR <b>${esc(lr.lrNo)}</b>${lr.lrDate ? ` · ${formatDate(lr.lrDate)}` : ""}`,
      route && esc(route),
      join([`Truck ${orDash(lr.truckNumber)}`, lr.driverMobile && `Driver ${esc(lr.driverMobile)}`], " · "),
      documents,
    ]),
  ),
  section(
    "PARTIES",
    brLines([
      `Consignor: ${esc(d.consignor?.name ?? "—")}`,
      `Consignee: ${esc(join([d.consignee?.name, d.consignee?.place], ", ") || "—")}`,
      `Billed to: ${esc(d.billedTo?.name ?? d.consignee?.name ?? "—")}`,
    ]),
  ),
])}
<table class="tbl"><thead><tr><th>Booked</th><th>Delivered</th><th>Condition</th><th>Delivered on</th><th>Received by</th></tr></thead>
<tbody><tr><td>${lr.totalPackages} pkgs${goods ? ` · ${esc(goods)}` : ""}</td><td>${
    pod.packagesReceived === null ? "—" : `${pod.packagesReceived} pkgs`
  }</td><td>${CONDITION_LABEL[pod.condition]}</td><td>${lr.deliveredAt ? formatDate(lr.deliveredAt) : "—"}</td><td>${receiver || "—"}</td></tr></tbody></table>
<div style="padding:10px 16px;border-top:1px solid var(--rule);margin-top:-1px;line-height:1.6">Remarks: ${
    pod.remarks?.trim() ? multiline(pod.remarks) : "—"
  }</div>
<div class="grow" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid var(--rule)">
${copiesBox(d)}
<div style="padding:12px;display:flex;flex-direction:column;justify-content:space-between;min-height:70mm"><div>${bold("Consignee signature & stamp")}</div>${signatureBlock(company, "Authorised signatory")}</div>
</div>
${rules ? `<div class="foot">${esc(rules)}</div>` : ""}
</div>`;

  return htmlDocument({
    title: `POD LR ${d.lr.lrNo} – ${company.name}`,
    watermarkSrc: company.useLogoWatermark ? company.logoSrc : null,
    mark: d.mark,
    body,
  });
}

// Building blocks shared by the four PDF templates. Output is a complete, self-contained HTML
// document (fonts and images inlined) that Chromium prints to A4. Colours are CSS variables
// declared once below, taken from the design tokens in CLAUDE.md / design/screens/*PDF*.dc.html.
import { fontFaceCss } from "../fonts";
import type { PdfCompany, PdfMark } from "../types";

/** HTML-escapes anything that came from the database. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaped text with line breaks kept (free-text terms, addresses). */
export function multiline(value: string | null | undefined): string {
  return esc(value?.trim() ?? "").replace(/\r?\n/g, "<br>");
}

/** Letters, digits, dot, dash, underscore: "ACM/FB/26-27/001" becomes "ACM-FB-26-27-001". */
export const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

/** Non-empty parts joined with a separator, each already HTML. */
export function join(parts: Array<string | null | undefined | false>, sep: string): string {
  return parts.filter((p): p is string => !!p).join(sep);
}

/** Non-empty parts as lines. */
export const brLines = (parts: Array<string | null | undefined | false>) => join(parts, "<br>");

export const bold = (text: string | null | undefined) => (text ? `<b>${esc(text)}</b>` : "");

/** A labelled block with the tinted title bar used by every design. */
export function section(title: string, innerHtml: string): string {
  return `<div class="sec"><div class="sec-t">${esc(title)}</div>${innerHtml}</div>`;
}

/** Equal-width columns of sections separated by rules. */
export function columns(cells: string[]): string {
  return `<div class="cols" style="grid-template-columns:repeat(${cells.length},minmax(0,1fr))">${cells.join("")}</div>`;
}

type Letterhead = {
  /** HTML on the right of the logo; default is GSTIN / PAN / MSME. */
  right?: string;
  logoHeight?: number;
};

/** GSTIN / PAN / MSME block. */
export function registrations(c: PdfCompany): string {
  return brLines([
    c.gstin && `GSTIN <b>${esc(c.gstin)}</b>`,
    c.pan && `PAN <b>${esc(c.pan)}</b>`,
    c.udyam && `MSME (Udyam) <b>${esc(c.udyam)}</b>`,
  ]);
}

/** Office, phones, email and website of the company, as printed under the logo. */
export function addressLine(c: PdfCompany): string {
  const phones = [c.mobile1, c.mobile2].filter(Boolean).join(", ");
  return brLines([
    join([esc(c.office), phones && `Mob. ${esc(phones)}`], " · "),
    join([c.email && esc(c.email), c.website && esc(c.website)], " · "),
  ]);
}

/** Logo (or the company name when there is no logo), registrations and address. */
export function letterhead(c: PdfCompany, o: Letterhead = {}): string {
  const logo = c.logoSrc
    ? `<img src="${c.logoSrc}" alt="${esc(c.name)}" style="height:${o.logoHeight ?? 44}px;max-width:300px;object-fit:contain">`
    : `<div class="co-name">${esc(c.name)}</div>`;
  return `<div class="lh"><div>${logo}</div><div class="lh-r">${o.right ?? registrations(c)}</div></div>
<div class="addr">${addressLine(c)}</div>`;
}

/** Signature image above "For <company>" and the signatory. */
export function signatureBlock(c: PdfCompany, role: string): string {
  const image = c.signatureSrc
    ? `<img src="${c.signatureSrc}" alt="" style="height:44px;max-width:180px;object-fit:contain"><br>`
    : "";
  const signatory = c.signatoryName ? `${esc(c.signatoryName)}<br>` : "";
  return `<div class="sign">${image}<b>For ${esc(c.name)}</b><br>${signatory}${esc(role)}</div>`;
}

const CSS = `
:root{--navy:#0F1E3D;--primary:#1F3A8A;--primary-soft:#E8EEFB;--rule:#6B7A99;--text:#111827;--muted:#4B5563;--mark:#B91C1C}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:'IBM Plex Sans','Noto Sans Devanagari',Arial,sans-serif;color:var(--text);font-size:12px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.mono{font-family:'IBM Plex Mono','Noto Sans Devanagari',monospace;font-weight:500}
.frame{position:relative;z-index:1;border:1.5px solid var(--navy);display:flex;flex-direction:column}
.grow{flex:1}
.copy{break-after:page}.copy:last-child{break-after:auto}
.lh{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;border-bottom:3px solid var(--primary)}
.lh-r{text-align:right;font-size:12px;line-height:1.5}
.co-name{font-size:20px;font-weight:700;color:var(--navy)}
.addr{padding:6px 16px;border-bottom:1px solid var(--rule);text-align:center}
.bar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:8px 16px;border-bottom:1px solid var(--rule)}
.title{font-size:18px;font-weight:700;color:var(--primary);letter-spacing:.04em}
.cols{display:grid;border-bottom:1px solid var(--rule)}
.cols>.sec{border-right:1px solid var(--rule)}.cols>.sec:last-child{border-right:0}
.sec{padding:8px 12px;overflow-wrap:anywhere}
.sec-t{font-weight:700;background:var(--primary-soft);margin:-8px -12px 6px;padding:4px 12px;color:var(--navy)}
table{border-collapse:collapse;width:100%}
th{background:var(--primary-soft);color:var(--navy);font-weight:600;font-size:12px;padding:6px;border:1px solid var(--rule);text-align:left}
td{font-size:12px;padding:6px;border:1px solid var(--rule);vertical-align:top;overflow-wrap:anywhere}
thead{display:table-header-group}tr{break-inside:avoid}
.r{text-align:right}.c{text-align:center}
.tbl{margin-top:-1px}
.foot{padding:6px 12px;border-top:1px solid var(--rule);color:var(--muted);text-align:center}
.sign{text-align:right}
.sigrow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--rule);break-inside:avoid}
.sigrow>div{padding:36px 12px 10px;border-right:1px solid var(--rule)}.sigrow>div:last-child{border-right:0;text-align:right}
.blank{display:inline-block;min-width:70px;border-bottom:1px solid var(--rule)}
.wm{position:fixed;z-index:0;pointer-events:none;left:50%;top:50%;transform:translate(-50%,-50%)}
.wm-logo{opacity:.07}
.wm-mark{font-size:150px;font-weight:700;letter-spacing:.08em;color:var(--mark);opacity:.1;transform:translate(-50%,-50%) rotate(-30deg)}
`;

type Doc = {
  title: string;
  /** Portrait A4 (default) or landscape A4. */
  landscape?: boolean;
  /** Logo printed faintly behind the page when set. */
  watermarkSrc?: string | null;
  mark?: PdfMark;
  body: string;
};

/** The complete HTML document. The frame's min-height keeps the signature rows at the page foot. */
export function htmlDocument(d: Doc): string {
  const minHeight = d.landscape ? "187mm" : "274mm";
  const wmWidth = d.landscape ? "200mm" : "150mm";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(d.title)}</title>
<style>${fontFaceCss()}${CSS}
@page{size:A4${d.landscape ? " landscape" : ""};margin:10.5mm}
.frame{min-height:${minHeight}}
</style></head><body>
${d.watermarkSrc ? `<img class="wm wm-logo" src="${d.watermarkSrc}" alt="" style="width:${wmWidth}">` : ""}
${d.mark ? `<div class="wm wm-mark">${d.mark}</div>` : ""}
${d.body}
</body></html>`;
}

/** A dash for missing values. */
export const orDash = (v: string | null | undefined) => (v && v.trim() ? esc(v) : "—");

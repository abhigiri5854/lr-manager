// The GST e-invoice QR: a signed JWT (header.payload.signature) whose payload carries
// { data: "<json string>", iss: "NIC" }. We read the payload only — the signature is not checked
// (we have no NIC key), so QR fields are trusted as "printed on the document", not as verified.
// Pure: no I/O, unit-testable.
import { gstinError, normaliseGstin } from "@/lib/validators/common";

export type EInvoiceQr = {
  sellerGstin: string;
  buyerGstin: string;
  docNo: string;
  /** yyyy-mm-dd */
  docDate: string | null;
  totalPaise: number | null;
  itemCount: number | null;
  mainHsn: string | null;
  irn: string | null;
  /** The text exactly as printed in the QR. */
  raw: string;
};

function base64UrlToString(part: string): string | null {
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** "10/10/2026" or "10-10-2026" → "2026-10-10"; anything else → null. */
export function qrDateToIso(value: unknown): string | null {
  const m = typeof value === "string" ? value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/) : null;
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = Number(d);
  const month = Number(mo);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const str = (v: unknown): string | null =>
  typeof v === "string" ? v.trim() || null : typeof v === "number" ? String(v) : null;

/** Rupees (number or numeric string, e.g. 184902.58) → integer paise. */
function rupeesToPaise(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Null when `text` isn't an e-invoice QR or lacks the two GSTINs and the document number. */
export function parseEInvoiceQr(text: string): EInvoiceQr | null {
  const raw = text.trim();
  const parts = raw.split(".");
  if (parts.length < 2) return null;
  const payloadText = base64UrlToString(parts[1]);
  if (!payloadText) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  // `data` is a JSON string in the real QR; accept an object too.
  let data: unknown = (payload as Record<string, unknown>).data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  const sellerGstin = normaliseGstin(str(d.SellerGstin) ?? "");
  const buyerGstin = normaliseGstin(str(d.BuyerGstin) ?? "");
  const docNo = str(d.DocNo);
  if (!sellerGstin || !buyerGstin || !docNo) return null;
  const items = Number(d.ItemCnt);
  return {
    sellerGstin,
    buyerGstin,
    docNo,
    docDate: qrDateToIso(d.DocDt),
    totalPaise: rupeesToPaise(d.TotInvVal),
    itemCount: Number.isInteger(items) && items > 0 ? items : null,
    mainHsn: str(d.MainHsnCode),
    irn: str(d.Irn),
    raw,
  };
}

/** True when both GSTINs pass the checksum (a decoded QR with a typo'd GSTIN is still shown, orange). */
export const qrGstinsValid = (q: EInvoiceQr): boolean =>
  gstinError(q.sellerGstin) === null && gstinError(q.buyerGstin) === null;

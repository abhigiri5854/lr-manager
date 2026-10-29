// Finds the GST e-invoice QR in an image or PDF page and returns its parsed payload.
import jsQR from "jsqr";
import { parseEInvoiceQr, type EInvoiceQr } from "../qr-payload";

type Pixels = { width: number; height: number; rgba: Uint8ClampedArray };

/** The e-invoice QR in these pixels, or null (no QR, unreadable, or some other kind of QR). */
export function scanPixels(p: Pixels): EInvoiceQr | null {
  const hit = jsQR(p.rgba, p.width, p.height, { inversionAttempts: "attemptBoth" });
  return hit ? parseEInvoiceQr(hit.data) : null;
}

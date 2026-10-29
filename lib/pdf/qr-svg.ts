// A QR code as inline SVG for the PDF templates (HTML → Chromium). Sync, so templates stay plain
// string builders. Error correction "L" keeps the signed e-invoice text (about 1–2 KB) scannable at print size.
import QRCode from "qrcode";

/** `text` → an <svg> of `size` px with a 4-module quiet zone, or "" when it doesn't fit a QR. */
export function qrSvg(text: string, size: number): string {
  let modules;
  try {
    modules = QRCode.create(text, { errorCorrectionLevel: "L" }).modules;
  } catch {
    return "";
  }
  const n = modules.size;
  const quiet = 4;
  const cells: string[] = [];
  for (let r = 0; r < n; r++) {
    // One rect per horizontal run of dark modules keeps the markup small.
    for (let c = 0; c < n; c++) {
      if (!modules.get(r, c)) continue;
      let end = c;
      while (end + 1 < n && modules.get(r, end + 1)) end++;
      cells.push(`M${c + quiet} ${r + quiet}h${end - c + 1}v1h-${end - c + 1}z`);
      c = end;
    }
  }
  const box = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges" role="img" aria-label="E-invoice QR code"><rect width="${box}" height="${box}" fill="#fff"/><path d="${cells.join("")}" fill="#000"/></svg>`;
}

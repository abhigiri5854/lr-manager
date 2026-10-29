// The fonts every PDF embeds (IBM Plex for Latin, Noto Sans Devanagari for Hindi), read once from
// lib/pdf/fonts/*.woff2 and inlined as base64 @font-face rules. Chromium on Vercel has no system
// fonts, so nothing may depend on them. next.config.ts includes the folder in the route bundles.
import { readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "lib", "pdf", "fonts");

// Latin subsets; the Devanagari file also carries ₹.
const FACES: { family: string; weight: number; file: string; range?: string }[] = [
  ...([400, 500, 600, 700] as const).map((weight) => ({
    family: "IBM Plex Sans",
    weight,
    file: `ibm-plex-sans-latin-${weight}-normal.woff2`,
  })),
  { family: "IBM Plex Mono", weight: 500, file: "ibm-plex-mono-latin-500-normal.woff2" },
  ...([400, 700] as const).map((weight) => ({
    family: "Noto Sans Devanagari",
    weight,
    file: `noto-sans-devanagari-devanagari-${weight}-normal.woff2`,
    range: "U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+25CC, U+A830-A839, U+A8E0-A8FF",
  })),
];

let cached: string | undefined;

/** The @font-face rules, with the font files inlined. */
export function fontFaceCss(): string {
  return (cached ??= FACES.map((f) => {
    const data = readFileSync(path.join(DIR, f.file)).toString("base64");
    return `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:normal;src:url(data:font/woff2;base64,${data}) format('woff2');${f.range ? `unicode-range:${f.range};` : ""}}`;
  }).join("\n"));
}

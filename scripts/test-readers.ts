// Accuracy check for the real Smart-import reader: reads every file in samples/ and compares the
// result with <file>.expected.json (values as printed). Calls the paid reader (Gemini) when
// AI_READER=gemini is set in .env.local. Run: pnpm test:readers [name-filter]
// Output holds field names and values only, never environment variables or keys.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getReader } from "../lib/import/reader";
import type { DocumentReadResult, ReadInvoice, ReaderFile } from "../lib/import/types";

const SAMPLES = path.join(process.cwd(), "samples");
const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
/** Expected keys that describe the test, not the document. */
const IGNORED = new Set(["type", "note"]);
/** Money may differ by this many rupees (rounding). */
const MONEY_TOLERANCE = 0.01;
const TOTAL_TOLERANCE = 1;

type Flat = Record<string, string | number | null>;
type Check = { field: string; expected: unknown; actual: unknown; ok: boolean };

const rupees = (paise: number) => paise / 100;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** dd-mm-yyyy in IST, as the app displays it. */
function ddmmyyyy(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

function flatten(inv: ReadInvoice): { head: Flat; items: Flat[] } {
  const items = inv.lines.map((l) => {
    const net = Number(l.qty) * rupees(l.ratePaise) - rupees(l.discountPaise);
    return {
      description: l.description,
      hsn: l.hsn,
      qty: Number(l.qty),
      uom: l.uom,
      rate: rupees(l.ratePaise),
      gstRate: l.gstRateBp / 100,
      amount: r2(net),
      gst: r2((net * l.gstRateBp) / 10000),
    } satisfies Flat;
  });
  const taxable = r2(items.reduce((s, i) => s + Number(i.amount), 0));
  const gstTotal = r2(items.reduce((s, i) => s + Number(i.gst), 0));
  const head: Flat = {
    invoiceNo: inv.invoiceNo,
    invoiceDate: ddmmyyyy(inv.invoiceAt),
    sellerName: inv.seller.name,
    sellerGstin: inv.seller.gstin,
    buyerName: inv.billTo.name,
    buyerGstin: inv.billTo.gstin,
    shipToName: inv.shipTo?.name ?? null,
    shipToGstin: inv.shipTo?.gstin ?? null,
    placeOfSupply: inv.billTo.stateCode,
    vehicleNo: inv.vehicleNo,
    transporter: inv.transporterName,
    ewayBillNo: inv.ewayBillNo,
    irn: inv.irn ?? null,
    taxable,
    gstTotal,
    total: r2(taxable + gstTotal),
  };
  return { head, items };
}

const norm = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function same(field: string, exp: unknown, act: unknown): boolean {
  if (exp === null || exp === undefined) return act === null || act === undefined || act === "";
  if (typeof exp === "number") {
    if (typeof act !== "number") return false;
    const tol = field === "total" ? TOTAL_TOLERANCE : MONEY_TOLERANCE;
    return Math.abs(exp - act) <= tol;
  }
  return norm(exp) === norm(act);
}

function compare(expected: Record<string, unknown>, doc: DocumentReadResult): Check[] {
  const checks: Check[] = [];
  const add = (field: string, exp: unknown, act: unknown) =>
    checks.push({ field, expected: exp, actual: act, ok: same(field, exp, act) });

  const flat = doc.invoice ? flatten(doc.invoice) : { head: {} as Flat, items: [] as Flat[] };
  // A rule: fields the reader has no slot for (route, sac, igst, ...) count as not read.
  for (const [key, exp] of Object.entries(expected)) {
    if (IGNORED.has(key) || key === "items" || key === "lines") continue;
    if (key === "gstTotal" || key === "taxable" || key === "total" || key in flat.head) {
      add(key, exp, flat.head[key] ?? null);
    } else if (key === "igst" || key === "cgst" || key === "sgst") {
      // Tax split: compare the sum only once, under "gst".
      continue;
    } else {
      add(key, exp, "(no slot in reader)");
    }
  }
  const split = ["igst", "cgst", "sgst"].filter((k) => typeof expected[k] === "number");
  if (split.length) {
    const sum = split.reduce((s, k) => s + (expected[k] as number), 0);
    checks.push({
      field: "gst (cgst+sgst+igst)",
      expected: r2(sum),
      actual: flat.head.gstTotal ?? null,
      ok: same("gst", r2(sum), flat.head.gstTotal ?? null),
    });
  }

  const expItems = (expected.items ?? expected.lines) as Record<string, unknown>[] | undefined;
  if (Array.isArray(expItems)) {
    add("items.count", expItems.length, flat.items.length);
    expItems.forEach((e, i) => {
      const a = flat.items[i];
      for (const [k, v] of Object.entries(e)) {
        // Freight-bill lines (date, lrNo, from, to ...) have no slot; their amount does.
        const known = k in (a ?? flat.items[0] ?? { amount: 0, description: 0 });
        if (!known && expected.lines) {
          if (k !== "amount") continue;
        }
        add(`items.${i + 1}.${k}`, v, known ? (a?.[k] ?? null) : "(no slot in reader)");
      }
    });
  }
  return checks;
}

const show = (v: unknown) => (v === null || v === undefined ? "null" : String(v));
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

async function main() {
  const filter = process.argv[2]?.toLowerCase();
  const files = (await readdir(SAMPLES))
    .filter((f) => !f.endsWith(".expected.json") && MIME[path.extname(f).toLowerCase()])
    .filter((f) => !filter || f.toLowerCase().includes(filter))
    .sort();
  const reader = getReader();
  let right = 0;
  let total = 0;
  const rows: { file: string; pct: string; wrong: number; of: number; note: string }[] = [];

  for (const name of files) {
    let expected: Record<string, unknown>;
    try {
      expected = JSON.parse(await readFile(path.join(SAMPLES, `${name}.expected.json`), "utf8"));
    } catch {
      console.log(`\n${name}: no ${name}.expected.json, skipped`);
      continue;
    }
    const file: ReaderFile = {
      name,
      type: MIME[path.extname(name).toLowerCase()],
      bytes: new Uint8Array(await readFile(path.join(SAMPLES, name))),
    };
    console.log(`\n=== ${name} ===`);
    const started = Date.now();
    let checks: Check[];
    let note = "";
    try {
      const doc = await reader.readDocument(file);
      note = `${doc.readBy?.join("+") ?? "-"}, ${((Date.now() - started) / 1000).toFixed(1)}s`;
      checks = compare(expected, doc);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  read failed: ${msg}`);
      note = "read failed";
      checks = compare(expected, { invoice: null } as DocumentReadResult);
    }
    const ok = checks.filter((c) => c.ok).length;
    right += ok;
    total += checks.length;
    const pct = checks.length ? ((ok / checks.length) * 100).toFixed(1) : "0.0";
    rows.push({ file: name, pct, wrong: checks.length - ok, of: checks.length, note });
    console.log(`  accuracy ${pct}% (${ok}/${checks.length}), read by ${note}`);
    const wrong = checks.filter((c) => !c.ok);
    if (wrong.length) {
      console.log(`  ${pad("wrong field", 26)} ${pad("expected", 34)} actual`);
      for (const c of wrong)
        console.log(`  ${pad(c.field, 26)} ${pad(show(c.expected), 34)} ${show(c.actual)}`);
    }
  }

  console.log("\n=== summary ===");
  console.log(`${pad("file", 40)} ${pad("accuracy", 9)} ${pad("wrong", 9)} read by`);
  for (const r of rows)
    console.log(`${pad(r.file, 40)} ${pad(r.pct + "%", 9)} ${pad(`${r.wrong}/${r.of}`, 9)} ${r.note}`);
  console.log(
    `\nOVERALL ${total ? ((right / total) * 100).toFixed(1) : "0.0"}% (${right}/${total} fields, ${rows.length} files)`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

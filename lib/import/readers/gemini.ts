// The last resort: one Gemini call (a second on the same model only if the first answer isn't
// valid JSON) that reads the invoice picture into a strict schema. Used only when the QR and the
// PDF text left required fields empty, and only when AI_READER=gemini and GEMINI_API_KEY is set.
// gemini-step.ts decides whether a stronger model is asked afterwards. The key stays on the
// server; nothing here is imported by client components.
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import type { Draft } from "../draft";
import { normaliseUom, textDateToIso } from "../text-parser";
import type { ImportCorrection } from "../types";
import { GEMINI_MODEL } from "./gemini-models";

export { GEMINI_MODEL } from "./gemini-models";

export const geminiEnabled = (): boolean =>
  process.env.AI_READER === "gemini" && Boolean(process.env.GEMINI_API_KEY);

const PROMPT =
  "Read this Indian GST tax invoice. Return JSON only. Copy values exactly as printed; " +
  "use null for anything not visible. Amounts in rupees as plain numbers. Date as yyyy-mm-dd. " +
  "GSTIN is 15 characters: copy it exactly as printed, even if it looks wrong. " +
  "One entry in lines per item row. uom as printed (KGS, MT, TON, NOS ...). " +
  "Names are the company names printed, never a label such as Seller or Buyer and never a GSTIN. " +
  "route is the printed route (e.g. Jamshedpur - Patna); fromPlace/toPlace its two ends. " +
  "shipTo* is the consignee / ship-to party when different from the buyer. " +
  "roundOff is signed. For a freight bill / transport invoice that lists consignments (LRs) in a " +
  "table, put EVERY table row in freightLines, in order, none skipped (date, lrNo, vehicleNo, " +
  "customer, from, to, vehicleType, freight, loading, unloading, detention, amount; 0 when blank). " +
  "Pages marked Original/Duplicate/Triplicate are the same invoice: read it once. " +
  "Read only what is printed in the attached picture. If it is blank, unreadable or not an invoice, " +
  "return null fields and an empty lines array. Never invent, complete or substitute example data.";

const nullableString = { type: Type.STRING, nullable: true };
const nullableNumber = { type: Type.NUMBER, nullable: true };

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    invoiceNo: nullableString,
    invoiceDate: nullableString,
    sellerName: nullableString,
    sellerGstin: nullableString,
    buyerName: nullableString,
    buyerGstin: nullableString,
    vehicleNo: nullableString,
    ewayBillNo: nullableString,
    shipToName: nullableString,
    shipToGstin: nullableString,
    transporter: nullableString,
    irn: nullableString,
    ackNo: nullableString,
    sac: nullableString,
    placeOfSupply: nullableString,
    otherReference: nullableString,
    route: nullableString,
    fromPlace: nullableString,
    toPlace: nullableString,
    destination: nullableString,
    lrNo: nullableString,
    lrDate: nullableString,
    roundOff: nullableNumber,
    taxable: nullableNumber,
    sgst: nullableNumber,
    cgst: nullableNumber,
    igst: nullableNumber,
    total: nullableNumber,
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING },
          hsn: nullableString,
          uom: nullableString,
          qty: { type: Type.NUMBER },
          rate: { type: Type.NUMBER },
          gstRatePercent: nullableNumber,
        },
        required: ["description", "qty", "rate"],
      },
    },
    freightLines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: nullableString,
          lrNo: nullableString,
          vehicleNo: nullableString,
          customer: nullableString,
          from: nullableString,
          to: nullableString,
          vehicleType: nullableString,
          freight: nullableNumber,
          loading: nullableNumber,
          unloading: nullableNumber,
          detention: nullableNumber,
          amount: nullableNumber,
        },
      },
    },
  },
  required: ["lines"],
};

const reply = z.object({
  invoiceNo: z.string().nullish(),
  invoiceDate: z.string().nullish(),
  sellerName: z.string().nullish(),
  sellerGstin: z.string().nullish(),
  buyerName: z.string().nullish(),
  buyerGstin: z.string().nullish(),
  vehicleNo: z.string().nullish(),
  ewayBillNo: z.string().nullish(),
  shipToName: z.string().nullish(),
  shipToGstin: z.string().nullish(),
  transporter: z.string().nullish(),
  irn: z.string().nullish(),
  ackNo: z.string().nullish(),
  sac: z.string().nullish(),
  placeOfSupply: z.string().nullish(),
  otherReference: z.string().nullish(),
  route: z.string().nullish(),
  fromPlace: z.string().nullish(),
  toPlace: z.string().nullish(),
  destination: z.string().nullish(),
  lrNo: z.string().nullish(),
  lrDate: z.string().nullish(),
  roundOff: z.number().nullish(),
  taxable: z.number().nullish(),
  sgst: z.number().nullish(),
  cgst: z.number().nullish(),
  igst: z.number().nullish(),
  total: z.number().nullish(),
  lines: z.array(
    z.object({
      description: z.string(),
      hsn: z.string().nullish(),
      uom: z.string().nullish(),
      qty: z.number(),
      rate: z.number(),
      gstRatePercent: z.number().nullish(),
    }),
  ),
  freightLines: z
    .array(
      z.object({
        date: z.string().nullish(),
        lrNo: z.string().nullish(),
        vehicleNo: z.string().nullish(),
        customer: z.string().nullish(),
        from: z.string().nullish(),
        to: z.string().nullish(),
        vehicleType: z.string().nullish(),
        freight: z.number().nullish(),
        loading: z.number().nullish(),
        unloading: z.number().nullish(),
        detention: z.number().nullish(),
        amount: z.number().nullish(),
      }),
    )
    .nullish(),
});

const paise = (rupees: number | null | undefined) =>
  typeof rupees === "number" && Number.isFinite(rupees) && rupees >= 0
    ? Math.round(rupees * 100)
    : undefined;

function toDraft(r: z.infer<typeof reply>): Draft {
  const draft: Draft = {
    lines: r.lines.map((l) => ({
      description: l.description.trim(),
      hsn: l.hsn?.replace(/\D/g, "") || null,
      uom: normaliseUom(l.uom),
      qty: String(l.qty),
      ratePaise: Math.round(l.rate * 100),
      gstRateBp: typeof l.gstRatePercent === "number" ? Math.round(l.gstRatePercent * 100) : null,
    })),
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K] | null | undefined) => {
    if (v !== undefined && v !== null && v !== "") draft[k] = v;
  };
  set("invoiceNo", r.invoiceNo?.trim());
  set("invoiceDate", r.invoiceDate ? (textDateToIso(r.invoiceDate) ?? undefined) : undefined);
  set("sellerName", r.sellerName?.trim());
  set("sellerGstin", r.sellerGstin?.trim());
  set("buyerName", r.buyerName?.trim());
  set("buyerGstin", r.buyerGstin?.trim());
  set("vehicleNo", r.vehicleNo?.trim());
  set("ewayBillNo", r.ewayBillNo?.replace(/\D/g, ""));
  set("taxablePaise", paise(r.taxable));
  set("sgstPaise", paise(r.sgst));
  set("cgstPaise", paise(r.cgst));
  set("igstPaise", paise(r.igst));
  // 0 is a missed column, not a printed total.
  set("totalPaise", r.total ? paise(r.total) : undefined);
  const txt = (v: string | null | undefined) => v?.trim() || undefined;
  set("shipToName", txt(r.shipToName));
  set("shipToGstin", txt(r.shipToGstin));
  set("transporter", txt(r.transporter));
  set("irn", txt(r.irn)?.toLowerCase());
  set("ackNo", r.ackNo?.replace(/\D/g, ""));
  set("sac", r.sac?.replace(/\D/g, ""));
  set("placeOfSupply", txt(r.placeOfSupply));
  set("otherReference", txt(r.otherReference));
  set("route", txt(r.route));
  set("fromPlace", txt(r.fromPlace));
  set("toPlace", txt(r.toPlace));
  set("destination", txt(r.destination));
  set("lrNo", txt(r.lrNo));
  set("lrDate", r.lrDate ? (textDateToIso(r.lrDate) ?? undefined) : undefined);
  if (typeof r.roundOff === "number" && Number.isFinite(r.roundOff) && r.roundOff !== 0)
    draft.roundOffPaise = Math.round(r.roundOff * 100);
  if (r.freightLines?.length) {
    const p = (v: number | null | undefined) =>
      typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null;
    draft.freightLines = r.freightLines.map((f) => ({
      date: f.date ? textDateToIso(f.date) : null,
      lrNo: txt(f.lrNo) ?? null,
      vehicleNo: txt(f.vehicleNo) ?? null,
      customer: txt(f.customer) ?? null,
      from: txt(f.from) ?? null,
      to: txt(f.to) ?? null,
      vehicleType: txt(f.vehicleType) ?? null,
      freightPaise: p(f.freight),
      loadingPaise: p(f.loading),
      unloadingPaise: p(f.unloading),
      detentionPaise: p(f.detention),
      amountPaise: p(f.amount),
    }));
  }
  return draft;
}

/**
 * Guards against an invented invoice: when the PDF has a text layer, the invoice number Gemini
 * returned must literally appear in it. Wording in names or items is never a reason to reject —
 * real documents and companies use words like "sample" or "example".
 * @returns the draft, or null when it must not be used.
 */
export function groundedInText(d: Draft, pdfText: string | null): Draft | null {
  if (!pdfText || !d.invoiceNo) return d;
  const flat = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return flat(pdfText).includes(flat(d.invoiceNo)) ? d : null;
}

/** Prompt addition: what users fixed on earlier invoices from this seller (at most 10). */
export function correctionHints(corrections: ImportCorrection[]): string {
  if (!corrections.length) return "";
  const lines = corrections
    .slice(0, 10)
    .map((c) => `- ${c.field}: "${c.wrong}" was wrong, correct is "${c.correct}"`);
  return (
    "\nEarlier readings of invoices from this same seller were corrected by the user as below. " +
    "Use them only as hints for similar text printed on this invoice; still copy what is printed.\n" +
    lines.join("\n")
  );
}

/** Output budget: a freight bill with 30+ LR rows plus the header is far over the default. */
const MAX_OUTPUT_TOKENS = 32768;
/** Waits before each retry after a 503 / 429 (so up to 3 calls in all). */
const BACKOFF_MS = [2000, 5000];

/** A temporary Google-side failure: overloaded (503) or rate limited (429). */
export function isTransientGeminiError(e: unknown): boolean {
  const o = e as { status?: unknown; code?: unknown } | null;
  const status = o?.status ?? o?.code;
  if (status === 503 || status === 429) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded/i.test(msg);
}

async function withBackoff<T>(call: () => Promise<T>, model: string): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await call();
    } catch (e) {
      if (!isTransientGeminiError(e) || retry >= BACKOFF_MS.length) throw e;
      console.warn("[import] gemini busy, retrying", { model, retry: retry + 1 });
      await new Promise((r) => setTimeout(r, BACKOFF_MS[retry]));
    }
  }
}

/**
 * @param images JPEGs, already compressed to 1600 px (lib/import/readers/image.ts) — one per page, at most two.
 * @param model which Gemini model reads it (default: the cheap first-read model)
 * @param corrections this seller's recent corrections, added to the prompt as hints
 * @returns what Gemini read, or null when both answers were invalid JSON.
 */
export async function readWithGemini(
  images: Uint8Array[],
  model: string = GEMINI_MODEL,
  corrections: ImportCorrection[] = [],
): Promise<Draft | null> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const parts = [
    ...images.map((img) => ({
      inlineData: { mimeType: "image/jpeg", data: Buffer.from(img).toString("base64") },
    })),
    { text: PROMPT + correctionHints(corrections) },
  ];

  // One more try for an answer that isn't valid JSON for the schema; 503 / 429 are retried in withBackoff.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await withBackoff(
      () =>
        ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        }),
      model,
    );
    const u = res.usageMetadata;
    console.info("[import] gemini", {
      model,
      attempt,
      images: images.length,
      promptTokens: u?.promptTokenCount,
      outputTokens: u?.candidatesTokenCount,
      totalTokens: u?.totalTokenCount,
    });
    try {
      return toDraft(reply.parse(JSON.parse(res.text ?? "")));
    } catch {
      /* invalid JSON or wrong shape: try once more */
    }
  }
  return null;
}

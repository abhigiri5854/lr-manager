// The last resort: one Gemini call (a second on the same model only if the first answer isn't
// valid JSON) that reads the invoice picture into a strict schema. Used only when the QR and the
// PDF text left required fields empty, and only when AI_READER=gemini and GEMINI_API_KEY is set.
// gemini-step.ts decides whether a stronger model is asked afterwards. The key stays on the
// server; nothing here is imported by client components.
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import type { Draft } from "../draft";
import { textDateToIso } from "../text-parser";
import { GEMINI_MODEL } from "./gemini-models";

export { GEMINI_MODEL } from "./gemini-models";

export const geminiEnabled = (): boolean =>
  process.env.AI_READER === "gemini" && Boolean(process.env.GEMINI_API_KEY);

const PROMPT =
  "Read this Indian GST tax invoice. Return JSON only. Copy values exactly as printed; " +
  "use null for anything not visible. Amounts in rupees as plain numbers. Date as yyyy-mm-dd. " +
  "GSTIN is 15 characters. One entry in lines per item row. " +
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
      uom: l.uom?.trim().toUpperCase() || null,
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
  set("totalPaise", paise(r.total));
  return draft;
}

/**
 * Guards against an invented invoice. Placeholder wording ("fictional", "example") means the model
 * made it up; and when the PDF has a text layer, the invoice number and every GSTIN/vehicle/e-way
 * number Gemini returned must literally appear in it.
 * @returns the draft, or null when it must not be used.
 */
export function groundedInText(d: Draft, pdfText: string | null): Draft | null {
  const words = [d.sellerName, d.buyerName, ...d.lines.map((l) => l.description)].join(" ");
  if (/(fictional|dummy|lorem|sample|example)/i.test(words)) return null;
  if (!pdfText) return d;
  const flat = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hay = flat(pdfText);
  const seen = (v: string | undefined) => !v || hay.includes(flat(v));
  if (d.invoiceNo && !seen(d.invoiceNo)) return null;
  const out = { ...d };
  for (const k of ["sellerGstin", "buyerGstin", "vehicleNo", "ewayBillNo"] as const) {
    if (!seen(out[k])) delete out[k];
  }
  return out;
}

/**
 * @param images JPEGs, already compressed to 1600 px (lib/import/readers/image.ts) — one per page, at most two.
 * @param model which Gemini model reads it (default: the cheap first-read model)
 * @returns what Gemini read, or null when both answers were invalid JSON.
 */
export async function readWithGemini(
  images: Uint8Array[],
  model: string = GEMINI_MODEL,
): Promise<Draft | null> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const parts = [
    ...images.map((img) => ({
      inlineData: { mimeType: "image/jpeg", data: Buffer.from(img).toString("base64") },
    })),
    { text: PROMPT },
  ];

  // One retry, and only for an answer that isn't valid JSON for the schema (never for API errors).
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
      },
    });
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

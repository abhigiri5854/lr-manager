// ONE Gemini call for the columns of an Excel / CSV sheet that name matching and saved mappings
// couldn't place. It sees the header names and three sample rows only. Same switch as the
// invoice reader: AI_READER=gemini and GEMINI_API_KEY. Server only.
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import type { ColumnQuestion } from "../column-suggest";
import { GEMINI_MODEL } from "./gemini";

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    columns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { header: { type: Type.STRING }, field: { type: Type.STRING } },
        required: ["header", "field"],
      },
    },
  },
  required: ["columns"],
};

const reply = z.object({ columns: z.array(z.object({ header: z.string(), field: z.string() })) });

function prompt(q: ColumnQuestion): string {
  return [
    "This is the top of a spreadsheet from an Indian transport company (lorry receipts / bookings).",
    "For each header in `ask`, say which system field it belongs to, using only the `key` values in `fields`.",
    "Leave a header out if none fits. Use each field at most once.",
    JSON.stringify({
      headers: q.headers,
      sampleRows: q.sampleRows,
      ask: q.unmapped,
      fields: q.freeFields,
    }),
  ].join("\n");
}

/** @returns Gemini's suggestions, or null when it failed (the columns then stay unmapped). */
export async function suggestColumnsWithGemini(
  q: ColumnQuestion,
): Promise<{ header: string; field: string }[] | null> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt(q) }] }],
      config: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
    });
    console.info("[import] gemini columns", {
      model: GEMINI_MODEL,
      asked: q.unmapped.length,
      totalTokens: res.usageMetadata?.totalTokenCount,
    });
    return reply.parse(JSON.parse(res.text ?? "")).columns;
  } catch (e) {
    console.warn("[import] gemini columns failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

import { GoogleGenerativeAI, GoogleGenerativeAIFetchError, type ResponseSchema } from "@google/generative-ai";
import type { ZodTypeAny, z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const NENA_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

/** Nena's voice, shared by every prompt. */
export const NENA_PERSONA = [
  "You are Nena, the assistant inside FinReports, working for a licensed Philippine accountant who manages several client companies.",
  "Write professional-to-professional: concise, precise, no beginner explanations, no filler, no emojis.",
  "Use Philippine accounting and BIR terminology (VAT, percentage tax, EWT, 2307, 1601-C, 2316, OSD, TRAIN).",
  "Amounts are in Philippine pesos. Never claim to have filed anything with the BIR; the accountant reviews and files.",
].join(" ");

export class NenaUnavailableError extends Error {}
export class NenaRateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Gemini rate limit reached; retry in ~${retryAfterSeconds}s`);
  }
}

export function isNenaConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

function client() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new NenaUnavailableError("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

const ALLOWED_KEYS = new Set(["type", "properties", "required", "items", "enum", "nullable", "description", "format"]);

/**
 * Zod → JSON Schema (OpenAPI 3 flavour) → the subset Gemini's responseSchema
 * accepts. Unsupported keywords (additionalProperties, $schema, min/max,
 * defaults) are dropped; string enums get format "enum".
 */
export function toGeminiSchema(schema: ZodTypeAny): ResponseSchema {
  const json = zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" });
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (!ALLOWED_KEYS.has(k)) continue;
      if (k === "properties") {
        out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, clean(pv)]));
      } else if (k === "format") {
        if (v === "date-time") out[k] = v;
      } else {
        out[k] = clean(v);
      }
    }
    if (out.enum && out.type === "string") out.format = "enum";
    return out;
  };
  return clean(json) as ResponseSchema;
}

function retryAfterFrom(e: GoogleGenerativeAIFetchError): number {
  const details = (e.errorDetails ?? []) as Array<{ "@type"?: string; retryDelay?: string }>;
  const info = details.find((d) => d["@type"]?.includes("RetryInfo"));
  const secs = info?.retryDelay ? parseInt(info.retryDelay, 10) : NaN;
  return Number.isFinite(secs) ? secs : 30;
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/** Structured generation validated against the same Zod schema. */
export async function generateStructured<S extends ZodTypeAny>(opts: {
  schema: S;
  system: string;
  parts: Part[];
  temperature?: number;
}): Promise<z.infer<S>> {
  const model = client().getGenerativeModel({
    model: NENA_MODEL,
    systemInstruction: `${NENA_PERSONA}\n\n${opts.system}`,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(opts.schema),
      temperature: opts.temperature ?? 0.1,
    },
  });
  try {
    const res = await model.generateContent(opts.parts);
    return opts.schema.parse(JSON.parse(res.response.text()));
  } catch (e) {
    if (e instanceof GoogleGenerativeAIFetchError && e.status === 429) throw new NenaRateLimitError(retryAfterFrom(e));
    throw e;
  }
}

/** Free-text generation (chat, narrative). */
export async function generateText(opts: { system: string; history?: { role: "user" | "model"; text: string }[]; prompt: string; temperature?: number }): Promise<string> {
  const model = client().getGenerativeModel({
    model: NENA_MODEL,
    systemInstruction: `${NENA_PERSONA}\n\n${opts.system}`,
    generationConfig: { temperature: opts.temperature ?? 0.3 },
  });
  try {
    const chat = model.startChat({ history: (opts.history ?? []).map((h) => ({ role: h.role, parts: [{ text: h.text }] })) });
    const res = await chat.sendMessage(opts.prompt);
    return res.response.text().trim();
  } catch (e) {
    if (e instanceof GoogleGenerativeAIFetchError && e.status === 429) throw new NenaRateLimitError(retryAfterFrom(e));
    throw e;
  }
}

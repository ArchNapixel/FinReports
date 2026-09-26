import { z } from "zod";
import { generateStructured } from "./gemini";

export const PAYMENT_METHODS = ["cash", "card", "bank_transfer", "gcash", "maya", "check", "other", "unknown"] as const;

/** What Nena extracts from a receipt image. */
export const ReceiptExtraction = z.object({
  vendor: z.string().describe("Registered business name as printed on the receipt"),
  vendorTin: z.string().nullable().describe("Seller TIN if printed (###-###-###-###)"),
  date: z.string().nullable().describe("Transaction date as YYYY-MM-DD, or null if unreadable"),
  totalAmount: z.number().nullable().describe("Total amount due / paid in PHP, VAT-inclusive"),
  vatAmount: z.number().nullable().describe("VAT amount in PHP if shown; 0 if VAT-exempt or non-VAT; null if unreadable"),
  paymentMethod: z.enum(PAYMENT_METHODS),
  referenceNumber: z.string().nullable().describe("OR/SI/invoice number"),
  suggestedCategory: z.string().describe("Account code from the provided chart of accounts"),
  confidence: z.number().describe("Overall extraction confidence from 0 to 1"),
  unreadableFields: z.array(z.string()).describe("Names of fields that could not be read confidently"),
  notes: z.string().describe("One short line for the accountant, e.g. 'Handwritten total; VAT not itemized'. Empty if nothing notable."),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtraction>;

export const LOW_CONFIDENCE = 0.7;

export async function extractReceipt(image: { mimeType: string; base64: string }, chart: { code: string; name: string }[]) {
  const coa = chart.map((a) => `${a.code} ${a.name}`).join("\n");
  return generateStructured({
    schema: ReceiptExtraction,
    system: [
      "Extract bookkeeping data from a Philippine receipt or invoice image.",
      "Do not guess: if a value is not legible, return null for it and list it in unreadableFields, and lower confidence.",
      "Amounts are numbers without currency symbols or commas.",
      "suggestedCategory must be one of these expense/asset account codes:",
      coa,
    ].join("\n"),
    parts: [{ inlineData: { mimeType: image.mimeType, data: image.base64 } }, { text: "Extract the receipt." }],
  });
}

/** Whether Nena should flag the draft for manual attention. */
export function needsAttention(x: ReceiptExtraction): string[] {
  const flags: string[] = [];
  if (x.confidence < LOW_CONFIDENCE) flags.push(`low confidence (${Math.round(x.confidence * 100)}%)`);
  if (x.totalAmount == null) flags.push("total not readable");
  if (!x.date) flags.push("date not readable");
  for (const f of x.unreadableFields) if (!flags.some((g) => g.includes(f))) flags.push(`${f} unclear`);
  return flags;
}

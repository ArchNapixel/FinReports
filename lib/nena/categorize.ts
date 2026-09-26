import { z } from "zod";
import type { AccountDef } from "@/lib/ledger/chart-of-accounts";
import { PH_STANDARD_COA } from "@/lib/ledger/chart-of-accounts";
import { generateStructured, isNenaConfigured } from "./gemini";

export const CategorySuggestion = z.object({
  accountCode: z.string(),
  confidence: z.number().describe("0 to 1"),
  rationale: z.string().describe("At most 12 words"),
});
export type CategorySuggestion = z.infer<typeof CategorySuggestion> & { accountName: string; engine: "gemini" | "rules" };

export interface CategorizeInput {
  vendor: string;
  description?: string;
  amount?: number;
  type: "debit" | "credit";
}

/** Deterministic fallback when Gemini is unavailable or rate limited. */
export function ruleBasedSuggestion(input: CategorizeInput, chart: { code: string; name: string; type: string }[]): CategorySuggestion {
  const text = `${input.vendor} ${input.description ?? ""}`.toLowerCase();
  const eligible = new Set(chart.map((a) => a.code));
  const wanted = input.type === "credit" ? ["revenue"] : ["expense", "cost_of_sales", "asset"];
  let best: AccountDef | undefined;
  let bestLen = 0;
  for (const a of PH_STANDARD_COA) {
    if (!eligible.has(a.code) || !wanted.includes(a.type)) continue;
    for (const k of a.keywords ?? []) if (text.includes(k) && k.length > bestLen) { best = a; bestLen = k.length; }
  }
  const fallback = input.type === "credit" ? "4010" : "6900";
  const code = best?.code ?? fallback;
  return {
    accountCode: code,
    accountName: chart.find((a) => a.code === code)?.name ?? code,
    confidence: best ? 0.6 : 0.2,
    rationale: best ? `Matched vendor keyword` : "No match; defaulted",
    engine: "rules",
  };
}

export async function suggestCategory(input: CategorizeInput, chart: { code: string; name: string; type: string }[]): Promise<CategorySuggestion> {
  if (!isNenaConfigured()) return ruleBasedSuggestion(input, chart);
  const pool = chart.filter((a) => (input.type === "credit" ? a.type === "revenue" : ["expense", "cost_of_sales", "asset"].includes(a.type)));
  const res = await generateStructured({
    schema: CategorySuggestion,
    system: [
      "Classify a transaction to one account in this Philippine SME chart of accounts. Return only a code from the list.",
      pool.map((a) => `${a.code} ${a.name}`).join("\n"),
    ].join("\n"),
    parts: [{ text: JSON.stringify(input) }],
  });
  const match = pool.find((a) => a.code === res.accountCode);
  if (!match) return ruleBasedSuggestion(input, chart);
  return { ...res, confidence: Math.max(0, Math.min(1, res.confidence)), accountName: match.name, engine: "gemini" };
}

import { formatPeso } from "@/lib/money";
import type { AccountRow, LedgerRow } from "@/lib/reports/types";
import { incomeStatement, trialBalance } from "@/lib/reports/financial";
import { generateText } from "./gemini";

export interface ChatTurn { role: "user" | "nena"; text: string }

/** A compact snapshot of the selected client's books for grounding Q&A. */
export function companyContext(name: string, rows: LedgerRow[], accounts: AccountRow[], asOf: string, extras: string[] = []) {
  const year = asOf.slice(0, 4);
  const tb = trialBalance(rows, accounts, asOf);
  const ytd = incomeStatement(rows, accounts, { from: `${year}-01-01`, to: asOf });
  return [
    `Client company: ${name}. As of ${asOf}.`,
    `YTD revenue ${formatPeso(ytd.revenue.total)}, expenses ${formatPeso(ytd.expenses.total + ytd.costOfSales.total)}, net income ${formatPeso(ytd.netIncome)}.`,
    "Trial balance (code name: debit/credit):",
    ...tb.map((r) => `${r.code} ${r.name}: ${r.debit ? formatPeso(r.debit) + " Dr" : formatPeso(r.credit) + " Cr"}`),
    ...extras,
  ].join("\n");
}

export async function answer(context: string, history: ChatTurn[], question: string) {
  return generateText({
    system: [
      "Answer the accountant's question about the selected client using the books snapshot below.",
      "Lead with the answer. Cite figures from the snapshot. If the data doesn't support an answer, say which report or entry to check.",
      "Keep it under 120 words unless a computation needs to be shown.",
      "",
      context,
    ].join("\n"),
    history: trimHistory(history),
    prompt: question,
  });
}

/** Gemini history must start with a user turn and alternate roles. */
function trimHistory(history: ChatTurn[]) {
  const turns = history.slice(-10).map((t) => ({ role: t.role === "user" ? ("user" as const) : ("model" as const), text: t.text }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns.filter((t, i) => i === 0 || t.role !== turns[i - 1].role);
}

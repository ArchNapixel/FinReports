import { formatPeso } from "@/lib/money";
import type { BalanceSheet, CashFlowStatement, IncomeStatement } from "@/lib/reports/financial";
import { generateText } from "./gemini";

function figures(is: IncomeStatement, prior: IncomeStatement | null, bs: BalanceSheet, cf: CashFlowStatement) {
  const pct = (a: number, b: number) => (b ? `${(((a - b) / Math.abs(b)) * 100).toFixed(1)}%` : "n/a");
  const lines = [
    `Period: ${is.period.from} to ${is.period.to}`,
    `Revenue: ${formatPeso(is.revenue.total)}${prior ? ` (prior: ${formatPeso(prior.revenue.total)}, ${pct(is.revenue.total, prior.revenue.total)})` : ""}`,
    `Cost of sales: ${formatPeso(is.costOfSales.total)}; gross profit: ${formatPeso(is.grossProfit)}`,
    `Operating expenses: ${formatPeso(is.expenses.total)}${prior ? ` (prior: ${formatPeso(prior.expenses.total)})` : ""}`,
    `Top expenses: ${is.expenses.lines.slice().sort((a, b) => b.amount - a.amount).slice(0, 5).map((l) => `${l.name} ${formatPeso(l.amount)}`).join("; ")}`,
    `Net income: ${formatPeso(is.netIncome)}${prior ? ` (prior: ${formatPeso(prior.netIncome)})` : ""}`,
    `Total assets: ${formatPeso(bs.totalAssets)}; liabilities: ${formatPeso(bs.liabilities.total)}; current assets: ${formatPeso(bs.currentAssets.total)}`,
    `Cash: opening ${formatPeso(cf.opening)}, operating ${formatPeso(cf.sections.operating.total)}, investing ${formatPeso(cf.sections.investing.total)}, financing ${formatPeso(cf.sections.financing.total)}, closing ${formatPeso(cf.closing)}`,
  ];
  return lines.join("\n");
}

/** MD&A narrative for the Financial Report, in Nena's voice. */
export async function writeMdaNarrative(company: string, is: IncomeStatement, prior: IncomeStatement | null, bs: BalanceSheet, cf: CashFlowStatement) {
  return generateText({
    system: [
      "Write the Management's Discussion and Analysis section for a small Philippine company's financial report.",
      "Audience: the company's accountant and owner. 3 short paragraphs max, ~180 words total, plain prose, no headings, no bullet points, no markdown.",
      "Cover results of operations, liquidity/cash, and one or two items that warrant the accountant's attention.",
      "Use only the figures given. Do not invent causes; where a driver is unknown, say what should be checked.",
    ].join(" "),
    prompt: `Company: ${company}\n${figures(is, prior, bs, cf)}`,
    temperature: 0.4,
  });
}

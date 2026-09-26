import type { Centavos } from "@/lib/money";
import type { AccountType, CashFlowClass } from "@/lib/ledger/chart-of-accounts";
import type { AccountRow, LedgerRow, Period } from "./types";

export interface StatementLine { code: string; name: string; amount: Centavos }
export interface StatementSection { title: string; lines: StatementLine[]; total: Centavos }

function inPeriod(r: LedgerRow, p: Period) {
  return r.entry_date >= p.from && r.entry_date <= p.to;
}

/** Signed balance per account, positive on the account's normal side. */
function balancesByType(rows: LedgerRow[], accounts: Map<string, AccountRow>, types: AccountType[]): Map<string, Centavos> {
  const m = new Map<string, Centavos>();
  for (const r of rows) {
    const a = accounts.get(r.account_code);
    if (!a || !types.includes(a.type)) continue;
    const debitNormal = a.type === "asset" || a.type === "expense" || a.type === "cost_of_sales";
    const v = debitNormal ? r.debit - r.credit : r.credit - r.debit;
    m.set(a.code, (m.get(a.code) ?? 0) + v);
  }
  return m;
}

function section(title: string, balances: Map<string, Centavos>, accounts: Map<string, AccountRow>): StatementSection {
  const lines = [...balances.entries()]
    .filter(([, v]) => v !== 0)
    .map(([code, amount]) => ({ code, name: accounts.get(code)?.name ?? code, amount }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return { title, lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

export interface IncomeStatement {
  period: Period;
  revenue: StatementSection;
  costOfSales: StatementSection;
  grossProfit: Centavos;
  expenses: StatementSection;
  netIncome: Centavos;
}

export function incomeStatement(rows: LedgerRow[], accountList: AccountRow[], period: Period): IncomeStatement {
  const accounts = new Map(accountList.map((a) => [a.code, a]));
  const pr = rows.filter((r) => inPeriod(r, period));
  const revenue = section("Revenue", balancesByType(pr, accounts, ["revenue"]), accounts);
  const costOfSales = section("Cost of Sales", balancesByType(pr, accounts, ["cost_of_sales"]), accounts);
  const expenses = section("Operating Expenses", balancesByType(pr, accounts, ["expense"]), accounts);
  const grossProfit = revenue.total - costOfSales.total;
  return { period, revenue, costOfSales, grossProfit, expenses, netIncome: grossProfit - expenses.total };
}

export interface BalanceSheet {
  asOf: string;
  currentAssets: StatementSection;
  noncurrentAssets: StatementSection;
  totalAssets: Centavos;
  liabilities: StatementSection;
  equity: StatementSection;
  earningsToDate: Centavos;
  totalLiabilitiesAndEquity: Centavos;
  balanced: boolean;
}

export function balanceSheet(rows: LedgerRow[], accountList: AccountRow[], asOf: string): BalanceSheet {
  const accounts = new Map(accountList.map((a) => [a.code, a]));
  const upTo = rows.filter((r) => r.entry_date <= asOf);
  const assets = balancesByType(upTo, accounts, ["asset"]);
  const current = new Map([...assets].filter(([c]) => accounts.get(c)?.subtype === "current"));
  const noncurrent = new Map([...assets].filter(([c]) => accounts.get(c)?.subtype !== "current"));
  const currentAssets = section("Current Assets", current, accounts);
  const noncurrentAssets = section("Non-current Assets", noncurrent, accounts);
  const liabilities = section("Liabilities", balancesByType(upTo, accounts, ["liability"]), accounts);
  const equity = section("Equity", balancesByType(upTo, accounts, ["equity"]), accounts);
  // No closing entries are posted, so cumulative P&L is carried here.
  const pl = balancesByType(upTo, accounts, ["revenue", "cost_of_sales", "expense"]);
  let earningsToDate = 0;
  for (const [code, v] of pl) earningsToDate += accounts.get(code)!.type === "revenue" ? v : -v;
  const totalAssets = currentAssets.total + noncurrentAssets.total;
  const totalLiabilitiesAndEquity = liabilities.total + equity.total + earningsToDate;
  return {
    asOf, currentAssets, noncurrentAssets, totalAssets, liabilities, equity, earningsToDate,
    totalLiabilitiesAndEquity, balanced: totalAssets === totalLiabilitiesAndEquity,
  };
}

export interface CashFlowStatement {
  period: Period;
  opening: Centavos;
  sections: Record<CashFlowClass, StatementSection>;
  netChange: Centavos;
  closing: Centavos;
}

/**
 * Direct-method cash flow. Each transaction's net cash movement is
 * attributed to its non-cash lines pro rata, and classified by those
 * accounts' cash_flow_class. Transfers between cash accounts net to zero.
 */
export function cashFlowStatement(rows: LedgerRow[], accountList: AccountRow[], period: Period): CashFlowStatement {
  const accounts = new Map(accountList.map((a) => [a.code, a]));
  const isCash = (code: string) => accounts.get(code)?.is_cash ?? false;
  const opening = rows.filter((r) => r.entry_date < period.from && isCash(r.account_code)).reduce((s, r) => s + r.debit - r.credit, 0);

  const byTxn = new Map<string, LedgerRow[]>();
  for (const r of rows.filter((r) => inPeriod(r, period))) {
    byTxn.set(r.transaction_id, [...(byTxn.get(r.transaction_id) ?? []), r]);
  }

  const buckets: Record<CashFlowClass, Map<string, Centavos>> = { operating: new Map(), investing: new Map(), financing: new Map() };
  for (const lines of byTxn.values()) {
    const cashNet = lines.filter((l) => isCash(l.account_code)).reduce((s, l) => s + l.debit - l.credit, 0);
    if (cashNet === 0) continue;
    const others = lines.filter((l) => !isCash(l.account_code));
    const weight = others.reduce((s, l) => s + Math.abs(l.debit - l.credit), 0);
    let allocated = 0;
    others.forEach((l, i) => {
      const share = i === others.length - 1 ? cashNet - allocated : Math.round((cashNet * Math.abs(l.debit - l.credit)) / weight);
      allocated += share;
      const cls = accounts.get(l.account_code)?.cash_flow_class ?? "operating";
      buckets[cls].set(l.account_code, (buckets[cls].get(l.account_code) ?? 0) + share);
    });
  }

  const sections = {
    operating: section("Cash Flows from Operating Activities", buckets.operating, accounts),
    investing: section("Cash Flows from Investing Activities", buckets.investing, accounts),
    financing: section("Cash Flows from Financing Activities", buckets.financing, accounts),
  };
  const netChange = sections.operating.total + sections.investing.total + sections.financing.total;
  return { period, opening, sections, netChange, closing: opening + netChange };
}

export interface TrialBalanceRow { code: string; name: string; type: AccountType; debit: Centavos; credit: Centavos }

export function trialBalance(rows: LedgerRow[], accountList: AccountRow[], asOf: string): TrialBalanceRow[] {
  const accounts = new Map(accountList.map((a) => [a.code, a]));
  const net = new Map<string, Centavos>();
  for (const r of rows) if (r.entry_date <= asOf) net.set(r.account_code, (net.get(r.account_code) ?? 0) + r.debit - r.credit);
  return [...net.entries()]
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, v]) => ({
      code, name: accounts.get(code)?.name ?? code, type: accounts.get(code)?.type ?? "expense",
      debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0,
    }));
}

import type { Centavos } from "@/lib/money";
import { SYSTEM_ACCOUNTS } from "@/lib/ledger/chart-of-accounts";
import type { AccountRow, LedgerRow, Period } from "./types";

function groupByTxn(rows: LedgerRow[]) {
  const m = new Map<string, LedgerRow[]>();
  for (const r of rows) m.set(r.transaction_id, [...(m.get(r.transaction_id) ?? []), r]);
  return m;
}

function within(rows: LedgerRow[], p: Period) {
  return rows.filter((r) => r.entry_date >= p.from && r.entry_date <= p.to);
}

export interface SalesLine {
  date: string;
  transaction_id: string;
  reference: string;
  customer: string;
  account_code: string;
  account_name: string;
  description: string;
  net: Centavos;
  vat: Centavos;
  gross: Centavos;
}

/** Itemized revenue: every revenue-account movement in the period. */
export function salesReport(rows: LedgerRow[], accountList: AccountRow[], period: Period): { lines: SalesLine[]; totals: { net: Centavos; vat: Centavos; gross: Centavos } } {
  const accounts = new Map(accountList.map((a) => [a.code, a]));
  const lines: SalesLine[] = [];
  for (const [id, txn] of groupByTxn(within(rows, period))) {
    const rev = txn.filter((l) => accounts.get(l.account_code)?.type === "revenue");
    if (!rev.length) continue;
    const vat = txn.filter((l) => l.account_code === SYSTEM_ACCOUNTS.outputVat).reduce((s, l) => s + l.credit - l.debit, 0);
    const revTotal = rev.reduce((s, l) => s + l.credit - l.debit, 0);
    let vatLeft = vat;
    rev.forEach((l, i) => {
      const net = l.credit - l.debit;
      const lineVat = i === rev.length - 1 ? vatLeft : revTotal ? Math.round((vat * net) / revTotal) : 0;
      vatLeft -= lineVat;
      lines.push({
        date: l.entry_date, transaction_id: id, reference: l.reference ?? "", customer: l.vendor,
        account_code: l.account_code, account_name: accounts.get(l.account_code)?.name ?? l.account_code,
        description: l.description || l.memo, net, vat: lineVat, gross: net + lineVat,
      });
    });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  const totals = lines.reduce((t, l) => ({ net: t.net + l.net, vat: t.vat + l.vat, gross: t.gross + l.gross }), { net: 0, vat: 0, gross: 0 });
  return { lines, totals };
}

export interface SummaryRow { key: string; label: string; net: Centavos; vat: Centavos; gross: Centavos; count: number }

function summarize(lines: SalesLine[], keyOf: (l: SalesLine) => [string, string]): SummaryRow[] {
  const m = new Map<string, SummaryRow>();
  for (const l of lines) {
    const [key, label] = keyOf(l);
    const r = m.get(key) ?? { key, label, net: 0, vat: 0, gross: 0, count: 0 };
    r.net += l.net; r.vat += l.vat; r.gross += l.gross; r.count += 1;
    m.set(key, r);
  }
  return [...m.values()];
}

export function salesSummary(lines: SalesLine[]) {
  return {
    byCategory: summarize(lines, (l) => [l.account_code, `${l.account_code} ${l.account_name}`]).sort((a, b) => b.gross - a.gross),
    byCustomer: summarize(lines, (l) => [l.customer || "—", l.customer || "(unspecified)"]).sort((a, b) => b.gross - a.gross),
    byMonth: summarize(lines, (l) => [l.date.slice(0, 7), l.date.slice(0, 7)]).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export interface CashLine {
  date: string;
  transaction_id: string;
  reference: string;
  party: string;
  cash_account: string;
  cash_account_name: string;
  counter_accounts: string;
  source: string;
  description: string;
  amount: Centavos;
}

/**
 * Cash movements per transaction and cash account. direction "out" gives the
 * disbursement register; "in" gives the cash receipts register.
 */
export function cashRegister(rows: LedgerRow[], accountList: AccountRow[], period: Period, direction: "in" | "out"): { lines: CashLine[]; total: Centavos } {
  const accounts = new Map(accountList.map((a) => [a.code, a]));
  const isCash = (c: string) => accounts.get(c)?.is_cash ?? false;
  const lines: CashLine[] = [];
  for (const [id, txn] of groupByTxn(within(rows, period))) {
    const counter = [...new Set(txn.filter((l) => !isCash(l.account_code)).map((l) => accounts.get(l.account_code)?.name ?? l.account_code))].join(", ");
    const perCash = new Map<string, Centavos>();
    for (const l of txn.filter((l) => isCash(l.account_code))) perCash.set(l.account_code, (perCash.get(l.account_code) ?? 0) + l.debit - l.credit);
    for (const [code, net] of perCash) {
      if (direction === "in" ? net <= 0 : net >= 0) continue;
      // Pure transfers between cash accounts are not receipts/disbursements.
      if (!counter) continue;
      const h = txn[0];
      lines.push({
        date: h.entry_date, transaction_id: id, reference: h.reference ?? "", party: h.vendor,
        cash_account: code, cash_account_name: accounts.get(code)?.name ?? code,
        counter_accounts: counter, source: h.source, description: h.description,
        amount: Math.abs(net),
      });
    }
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

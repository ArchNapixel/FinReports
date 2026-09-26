import type { Centavos } from "@/lib/money";
import { SYSTEM_ACCOUNTS } from "./chart-of-accounts";
import type { JournalDraft, JournalLine, TxnSource, TxnType } from "./types";

export class LedgerError extends Error {}

export function totals(lines: JournalLine[]): { debit: Centavos; credit: Centavos } {
  return lines.reduce(
    (t, l) => ({ debit: t.debit + l.debit, credit: t.credit + l.credit }),
    { debit: 0, credit: 0 },
  );
}

export function assertBalanced(lines: JournalLine[]): void {
  if (lines.length < 2) throw new LedgerError("A journal entry needs at least two lines");
  for (const l of lines) {
    if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit)) throw new LedgerError("Amounts must be whole centavos");
    if (l.debit < 0 || l.credit < 0) throw new LedgerError("Negative amounts are not allowed; swap the side instead");
    if ((l.debit === 0) === (l.credit === 0)) throw new LedgerError(`Line ${l.account_code} must have exactly one of debit or credit`);
  }
  const t = totals(lines);
  if (t.debit !== t.credit) throw new LedgerError(`Unbalanced entry: debits ${t.debit} ≠ credits ${t.credit}`);
}

export interface SimpleTransactionInput {
  id: string;
  date: string;
  vendor: string;
  description?: string;
  type: TxnType;
  source: TxnSource;
  /** Gross amount including VAT. */
  amount: Centavos;
  /** VAT portion of `amount` (input VAT on purchases, output VAT on sales). */
  vatAmount?: Centavos;
  categoryAccount: string;
  /** Cash/bank/e-wallet (or AR/AP) account on the other side. */
  counterAccount?: string;
  receipt_url?: string | null;
  reference?: string | null;
  categorized_by?: "accountant" | "nena";
  nena_confidence?: number | null;
}

/**
 * Build the double entry for a single-category transaction.
 *  debit  (outflow):  Dr category [+ Dr Input VAT]  / Cr cash
 *  credit (inflow):   Dr cash / Cr category [+ Cr Output VAT]
 */
export function buildSimpleJournal(input: SimpleTransactionInput): JournalDraft {
  const vat = input.vatAmount ?? 0;
  if (input.amount <= 0) throw new LedgerError("Amount must be positive");
  if (vat < 0 || vat >= input.amount) throw new LedgerError("VAT must be less than the gross amount");
  const net = input.amount - vat;
  const cash = input.counterAccount ?? SYSTEM_ACCOUNTS.cashOnHand;
  const memo = input.description || input.vendor;

  const lines: JournalLine[] =
    input.type === "debit"
      ? [
          { account_code: input.categoryAccount, debit: net, credit: 0, memo },
          ...(vat ? [{ account_code: SYSTEM_ACCOUNTS.inputVat, debit: vat, credit: 0, memo: "Input VAT" }] : []),
          { account_code: cash, debit: 0, credit: input.amount, memo },
        ]
      : [
          { account_code: cash, debit: input.amount, credit: 0, memo },
          { account_code: input.categoryAccount, debit: 0, credit: net, memo },
          ...(vat ? [{ account_code: SYSTEM_ACCOUNTS.outputVat, debit: 0, credit: vat, memo: "Output VAT" }] : []),
        ];

  const draft: JournalDraft = {
    id: input.id,
    date: input.date,
    vendor: input.vendor,
    description: input.description ?? "",
    category: input.categoryAccount,
    type: input.type,
    source: input.source,
    amount: input.amount,
    receipt_url: input.receipt_url ?? null,
    reference: input.reference ?? null,
    categorized_by: input.categorized_by ?? "accountant",
    nena_confidence: input.nena_confidence ?? null,
    lines,
  };
  assertBalanced(draft.lines);
  return draft;
}

/** Build a multi-line (compound) journal, e.g. payroll or a manual JE. */
export function buildCompoundJournal(
  base: Omit<JournalDraft, "lines" | "amount"> & { amount?: Centavos },
  lines: JournalLine[],
): JournalDraft {
  const clean = lines.filter((l) => l.debit !== 0 || l.credit !== 0);
  assertBalanced(clean);
  return { ...base, amount: base.amount ?? totals(clean).debit, lines: clean };
}

export interface PostedTransaction {
  id: string;
  date: string;
  vendor: string;
  description: string;
  category: string;
  type: TxnType;
  source: TxnSource;
  amount: Centavos;
  reverses_transaction_id: string | null;
  lines: JournalLine[];
}

/**
 * Mirror-image entry that cancels `original`. The original stays in the
 * chain untouched; together they net to zero.
 */
export function buildReversal(
  original: PostedTransaction,
  opts: { id: string; date: string; reason: string; alreadyReversed?: boolean },
): JournalDraft {
  if (original.source === "reversal" || original.reverses_transaction_id) {
    throw new LedgerError("A reversing entry cannot itself be reversed; repost the original instead");
  }
  if (opts.alreadyReversed) throw new LedgerError("This transaction has already been reversed");
  if (opts.date < original.date) throw new LedgerError("Reversal date cannot precede the original entry");
  const lines = original.lines.map((l) => ({
    account_code: l.account_code,
    debit: l.credit,
    credit: l.debit,
    memo: `Reversal: ${l.memo ?? ""}`.trim(),
  }));
  assertBalanced(lines);
  return {
    id: opts.id,
    date: opts.date,
    vendor: original.vendor,
    description: `Reversal of ${original.id.slice(0, 8)} — ${opts.reason}`,
    category: original.category,
    type: original.type === "debit" ? "credit" : "debit",
    source: "reversal",
    amount: original.amount,
    reverses_transaction_id: original.id,
    categorized_by: "accountant",
    lines,
  };
}

/** Net balance per account code (debit − credit) across the given lines. */
export function accountBalances(lines: Pick<JournalLine, "account_code" | "debit" | "credit">[]): Map<string, Centavos> {
  const m = new Map<string, Centavos>();
  for (const l of lines) m.set(l.account_code, (m.get(l.account_code) ?? 0) + l.debit - l.credit);
  return m;
}

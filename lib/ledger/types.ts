import type { Centavos } from "@/lib/money";

export type TxnType = "debit" | "credit";
export type TxnSource = "receipt" | "manual" | "invoice" | "bill" | "payment" | "payroll" | "reversal";

export interface JournalLine {
  account_code: string;
  debit: Centavos;
  credit: Centavos;
  memo?: string;
}

/** A journal entry before it is hashed and appended to the chain. */
export interface JournalDraft {
  id: string;
  date: string; // YYYY-MM-DD
  vendor: string;
  description: string;
  category: string; // primary (category) account code
  type: TxnType;
  source: TxnSource;
  amount: Centavos;
  receipt_url?: string | null;
  reference?: string | null;
  reverses_transaction_id?: string | null;
  categorized_by?: "accountant" | "nena";
  nena_confidence?: number | null;
  lines: JournalLine[];
}

export interface ChainedLine extends JournalLine {
  seq: number;
  entry_date: string;
  hash: string;
  previous_hash: string;
}

export interface ChainedJournal extends Omit<JournalDraft, "lines"> {
  hash: string;
  previous_hash: string;
  lines: ChainedLine[];
}

export interface ChainHead {
  seq: number;
  hash: string;
}

export const GENESIS_HASH = "0".repeat(64);

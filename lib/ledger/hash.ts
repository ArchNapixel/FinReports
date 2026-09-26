import { createHash } from "node:crypto";
import { centavosToDecimalString } from "@/lib/money";
import type { ChainHead, ChainedJournal, ChainedLine, JournalDraft } from "./types";
import { GENESIS_HASH } from "./types";
import { assertBalanced } from "./journal";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Canonical, order-stable serialization of a ledger line. Amounts are fixed
 * two-decimal strings so the same value hashes identically whether it came
 * from TypeScript centavos or a Postgres numeric.
 */
export function canonicalLine(line: {
  company_id: string;
  transaction_id: string;
  seq: number;
  entry_date: string;
  account_code: string;
  debit: number;
  credit: number;
  memo?: string;
  previous_hash: string;
}): string {
  return [
    line.company_id,
    line.transaction_id,
    String(line.seq),
    line.entry_date,
    line.account_code,
    centavosToDecimalString(line.debit),
    centavosToDecimalString(line.credit),
    line.memo ?? "",
    line.previous_hash,
  ].join("|");
}

/** Append a balanced journal entry to the company's chain. */
export function chainJournal(companyId: string, draft: JournalDraft, head: ChainHead | null): ChainedJournal {
  assertBalanced(draft.lines);
  let prev = head?.hash ?? GENESIS_HASH;
  let seq = head?.seq ?? 0;
  const firstPrev = prev;
  const lines: ChainedLine[] = draft.lines.map((l) => {
    seq += 1;
    const previous_hash = prev;
    const hash = sha256(
      canonicalLine({
        company_id: companyId,
        transaction_id: draft.id,
        seq,
        entry_date: draft.date,
        account_code: l.account_code,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo,
        previous_hash,
      }),
    );
    prev = hash;
    return { ...l, memo: l.memo ?? "", seq, entry_date: draft.date, hash, previous_hash };
  });
  return { ...draft, lines, previous_hash: firstPrev, hash: prev };
}

export interface StoredLine {
  transaction_id: string;
  seq: number;
  entry_date: string;
  account_code: string;
  debit: number; // centavos
  credit: number; // centavos
  memo: string;
  hash: string;
  previous_hash: string;
}

export type ChainVerification =
  | { ok: true; count: number; head: string }
  | { ok: false; count: number; brokenAtSeq: number; reason: string };

/** Re-derive every hash from genesis; any edited or missing row breaks it. */
export function verifyChain(companyId: string, lines: StoredLine[]): ChainVerification {
  const sorted = [...lines].sort((a, b) => a.seq - b.seq);
  let prev = GENESIS_HASH;
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    if (l.seq !== i + 1) return { ok: false, count: i, brokenAtSeq: l.seq, reason: `gap in sequence before #${l.seq}` };
    if (l.previous_hash !== prev) return { ok: false, count: i, brokenAtSeq: l.seq, reason: "previous_hash does not match prior entry" };
    const expected = sha256(canonicalLine({ ...l, company_id: companyId }));
    if (expected !== l.hash) return { ok: false, count: i, brokenAtSeq: l.seq, reason: "content does not match stored hash" };
    prev = l.hash;
  }
  return { ok: true, count: sorted.length, head: prev };
}

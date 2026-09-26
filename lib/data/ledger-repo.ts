import { randomUUID } from "node:crypto";
import { centavosToDecimalString, toCentavos } from "@/lib/money";
import { chainJournal, verifyChain, type StoredLine } from "@/lib/ledger/hash";
import { COA_TEMPLATES } from "@/lib/ledger/chart-of-accounts";
import type { JournalDraft, JournalLine } from "@/lib/ledger/types";
import type { PostedTransaction } from "@/lib/ledger/journal";
import type { AccountRow, LedgerRow } from "@/lib/reports/types";
import type { Supabase } from "@/lib/supabase/server";
import { HttpError } from "./http";

export const newId = () => randomUUID();

/** PostgREST caps responses (1000 rows by default); page through. */
export async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) throw new HttpError(500, error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) return out;
  }
}

export async function seedChartOfAccounts(supabase: Supabase, companyId: string, template: string) {
  const defs = COA_TEMPLATES[template] ?? COA_TEMPLATES.ph_standard;
  const { error } = await supabase.from("accounts").insert(
    defs.map((a) => ({
      client_company_id: companyId, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? "",
      is_cash: !!a.is_cash, cash_flow_class: a.cash_flow_class ?? "operating",
    })),
  );
  if (error) throw new HttpError(500, error.message);
}

export async function loadAccounts(supabase: Supabase, companyId: string): Promise<AccountRow[]> {
  const { data, error } = await supabase.from("accounts").select("code,name,type,subtype,is_cash,cash_flow_class")
    .eq("client_company_id", companyId).eq("active", true).order("code");
  if (error) throw new HttpError(500, error.message);
  return data as AccountRow[];
}

interface RawLine {
  transaction_id: string; seq: number; entry_date: string; account_code: string;
  debit: number | string; credit: number | string; memo: string; hash: string; previous_hash: string;
  transactions: { vendor: string; description: string; reference: string | null; source: LedgerRow["source"] };
}

/** All ledger lines (optionally up to a date), joined with their headers. */
export async function loadLedgerRows(supabase: Supabase, companyId: string, upTo?: string): Promise<LedgerRow[]> {
  const raw = await fetchAll<RawLine>((from, to) => {
    let q = supabase.from("ledger_entries")
      .select("transaction_id,seq,entry_date,account_code,debit,credit,memo,hash,previous_hash,transactions!inner(vendor,description,reference,source)")
      .eq("client_company_id", companyId);
    if (upTo) q = q.lte("entry_date", upTo);
    return q.order("seq").range(from, to) as unknown as PromiseLike<{ data: RawLine[] | null; error: { message: string } | null }>;
  });
  return raw.map((r) => ({
    transaction_id: r.transaction_id, seq: Number(r.seq), entry_date: r.entry_date, account_code: r.account_code,
    debit: toCentavos(r.debit), credit: toCentavos(r.credit), memo: r.memo,
    vendor: r.transactions.vendor, description: r.transactions.description, reference: r.transactions.reference, source: r.transactions.source,
  }));
}

async function chainHead(supabase: Supabase, companyId: string) {
  const { data, error } = await supabase.from("ledger_entries").select("seq,hash")
    .eq("client_company_id", companyId).order("seq", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data ? { seq: Number(data.seq), hash: data.hash as string } : null;
}

/**
 * Hash-chain and append a journal entry. The DB function re-checks the head
 * under an advisory lock; if another write won the race we re-read and retry.
 */
export async function postJournal(supabase: Supabase, companyId: string, draft: JournalDraft): Promise<{ id: string; hash: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const head = await chainHead(supabase, companyId);
    const j = chainJournal(companyId, draft, head);
    const { error } = await supabase.rpc("post_journal", {
      p_company: companyId,
      p_txn: {
        id: j.id, vendor: j.vendor, amount: centavosToDecimalString(j.amount), date: j.date, category: j.category,
        description: j.description, receipt_url: j.receipt_url ?? null, hash: j.hash, previous_hash: j.previous_hash,
        type: j.type, source: j.source, reference: j.reference ?? null, reverses_transaction_id: j.reverses_transaction_id ?? null,
        categorized_by: j.categorized_by ?? "accountant", nena_confidence: j.nena_confidence ?? null,
      },
      p_lines: j.lines.map((l) => ({
        seq: l.seq, account_code: l.account_code, debit: centavosToDecimalString(l.debit), credit: centavosToDecimalString(l.credit),
        entry_date: l.entry_date, memo: l.memo ?? "", hash: l.hash, previous_hash: l.previous_hash,
      })),
    });
    if (!error) return { id: j.id, hash: j.hash };
    if (!/CHAIN_HEAD_MOVED|duplicate key/.test(error.message)) throw new HttpError(422, error.message);
  }
  throw new HttpError(409, "Ledger is busy; please retry");
}

export async function loadPostedTransaction(supabase: Supabase, companyId: string, id: string): Promise<PostedTransaction & { reversed: boolean }> {
  const { data: t, error } = await supabase.from("transactions").select("*").eq("client_company_id", companyId).eq("id", id).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!t) throw new HttpError(404, "Transaction not found");
  const { data: lines } = await supabase.from("ledger_entries").select("account_code,debit,credit,memo").eq("transaction_id", id).order("seq");
  const { count } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("reverses_transaction_id", id);
  return {
    id: t.id, date: t.date, vendor: t.vendor, description: t.description, category: t.category, type: t.type, source: t.source,
    amount: toCentavos(t.amount), reverses_transaction_id: t.reverses_transaction_id,
    lines: (lines ?? []).map((l): JournalLine => ({ account_code: l.account_code, debit: toCentavos(l.debit), credit: toCentavos(l.credit), memo: l.memo })),
    reversed: (count ?? 0) > 0,
  };
}

export async function verifyCompanyChain(supabase: Supabase, companyId: string) {
  const raw = await fetchAll<StoredLine & { debit: number | string; credit: number | string }>((from, to) =>
    supabase.from("ledger_entries").select("transaction_id,seq,entry_date,account_code,debit,credit,memo,hash,previous_hash")
      .eq("client_company_id", companyId).order("seq").range(from, to) as never,
  );
  return verifyChain(companyId, raw.map((r) => ({ ...r, seq: Number(r.seq), debit: toCentavos(r.debit), credit: toCentavos(r.credit) })));
}

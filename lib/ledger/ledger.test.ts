import { describe, expect, it } from "vitest";
import { accountBalances, assertBalanced, buildCompoundJournal, buildReversal, buildSimpleJournal, LedgerError, totals } from "./journal";
import type { PostedTransaction } from "./journal";
import { chainJournal, verifyChain, type StoredLine } from "./hash";
import { GENESIS_HASH } from "./types";

const CO = "11111111-1111-1111-1111-111111111111";

function receipt(id: string, amount: number, vat = 0) {
  return buildSimpleJournal({
    id, date: "2026-03-15", vendor: "Meralco", type: "debit", source: "receipt",
    amount, vatAmount: vat, categoryAccount: "6110", counterAccount: "1010",
  });
}

function toPosted(d: ReturnType<typeof receipt>): PostedTransaction {
  return { ...d, reverses_transaction_id: d.reverses_transaction_id ?? null };
}

function store(journals: ReturnType<typeof chainJournal>[]): StoredLine[] {
  return journals.flatMap((j) => j.lines.map((l) => ({ ...l, transaction_id: j.id, memo: l.memo ?? "" })));
}

describe("double-entry balancing", () => {
  it("builds a balanced expense entry with input VAT", () => {
    const j = receipt("t1", 11200_00, 1200_00);
    expect(j.lines).toEqual([
      expect.objectContaining({ account_code: "6110", debit: 10000_00, credit: 0 }),
      expect.objectContaining({ account_code: "1300", debit: 1200_00, credit: 0 }),
      expect.objectContaining({ account_code: "1010", debit: 0, credit: 11200_00 }),
    ]);
    const t = totals(j.lines);
    expect(t.debit).toBe(t.credit);
  });

  it("builds a balanced revenue entry with output VAT", () => {
    const j = buildSimpleJournal({
      id: "t2", date: "2026-03-01", vendor: "Client A", type: "credit", source: "manual",
      amount: 5600_00, vatAmount: 600_00, categoryAccount: "4010", counterAccount: "1010",
    });
    expect(accountBalances(j.lines)).toEqual(new Map([["1010", 5600_00], ["4010", -5000_00], ["2100", -600_00]]));
  });

  it("rejects unbalanced, one-sided, negative and fractional lines", () => {
    expect(() => assertBalanced([
      { account_code: "1000", debit: 100, credit: 0 },
      { account_code: "4000", debit: 0, credit: 99 },
    ])).toThrow(/Unbalanced/);
    expect(() => assertBalanced([{ account_code: "1000", debit: 100, credit: 0 }])).toThrow(LedgerError);
    expect(() => assertBalanced([
      { account_code: "1000", debit: 100, credit: 100 },
      { account_code: "4000", debit: 0, credit: 0 },
    ])).toThrow(/exactly one/);
    expect(() => assertBalanced([
      { account_code: "1000", debit: -100, credit: 0 },
      { account_code: "4000", debit: 0, credit: -100 },
    ])).toThrow(/Negative/);
    expect(() => assertBalanced([
      { account_code: "1000", debit: 10.5, credit: 0 },
      { account_code: "4000", debit: 0, credit: 10.5 },
    ])).toThrow(/centavos/);
  });

  it("rejects VAT greater than or equal to the gross amount", () => {
    expect(() => receipt("x", 100_00, 100_00)).toThrow(LedgerError);
  });

  it("drops zero lines from compound journals and still requires balance", () => {
    const j = buildCompoundJournal(
      { id: "p1", date: "2026-03-31", vendor: "Payroll", description: "", category: "6000", type: "debit", source: "payroll" },
      [
        { account_code: "6000", debit: 30000_00, credit: 0 },
        { account_code: "2110", debit: 0, credit: 0 },
        { account_code: "1010", debit: 0, credit: 30000_00 },
      ],
    );
    expect(j.lines).toHaveLength(2);
    expect(j.amount).toBe(30000_00);
  });
});

describe("reversal", () => {
  it("mirrors every line so original + reversal nets to zero per account", () => {
    const orig = receipt("t1", 11200_00, 1200_00);
    const rev = buildReversal(toPosted(orig), { id: "r1", date: "2026-03-20", reason: "wrong category" });
    expect(rev.source).toBe("reversal");
    expect(rev.reverses_transaction_id).toBe("t1");
    expect(rev.type).toBe("credit");
    const net = accountBalances([...orig.lines, ...rev.lines]);
    for (const v of net.values()) expect(v).toBe(0);
  });

  it("refuses to reverse a reversal, reverse twice, or back-date", () => {
    const orig = toPosted(receipt("t1", 500_00));
    const rev = toPosted(buildReversal(orig, { id: "r1", date: "2026-03-20", reason: "x" }));
    expect(() => buildReversal(rev, { id: "r2", date: "2026-03-21", reason: "x" })).toThrow(/cannot itself be reversed/);
    expect(() => buildReversal(orig, { id: "r3", date: "2026-03-21", reason: "x", alreadyReversed: true })).toThrow(/already been reversed/);
    expect(() => buildReversal(orig, { id: "r4", date: "2026-03-01", reason: "x" })).toThrow(/precede/);
  });

  it("reverse-and-repost leaves only the corrected entry's effect", () => {
    const orig = receipt("t1", 1000_00);
    const rev = buildReversal(toPosted(orig), { id: "r1", date: "2026-03-20", reason: "should be communication" });
    const repost = buildSimpleJournal({
      id: "t2", date: "2026-03-20", vendor: "Meralco", type: "debit", source: "manual",
      amount: 1000_00, categoryAccount: "6120", counterAccount: "1010",
    });
    const net = accountBalances([...orig.lines, ...rev.lines, ...repost.lines]);
    expect(net.get("6110")).toBe(0);
    expect(net.get("6120")).toBe(1000_00);
    expect(net.get("1010")).toBe(-1000_00);
  });
});

describe("SHA-256 hash chain", () => {
  it("links each line to the previous one starting from genesis", () => {
    const a = chainJournal(CO, receipt("t1", 1000_00, 100_00), null);
    expect(a.lines[0].previous_hash).toBe(GENESIS_HASH);
    expect(a.lines.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(a.lines[1].previous_hash).toBe(a.lines[0].hash);
    expect(a.hash).toBe(a.lines[2].hash);
    const b = chainJournal(CO, receipt("t2", 50_00), { seq: 3, hash: a.hash });
    expect(b.previous_hash).toBe(a.hash);
    expect(b.lines[0].seq).toBe(4);
    expect(verifyChain(CO, store([a, b]))).toEqual({ ok: true, count: 5, head: b.hash });
  });

  it("detects a tampered amount, a deleted row and a foreign company", () => {
    const a = chainJournal(CO, receipt("t1", 1000_00), null);
    const b = chainJournal(CO, receipt("t2", 50_00), { seq: 2, hash: a.hash });
    const lines = store([a, b]);

    const tampered = lines.map((l) => (l.seq === 3 ? { ...l, debit: l.debit + 1 } : l));
    expect(verifyChain(CO, tampered)).toMatchObject({ ok: false, brokenAtSeq: 3 });

    const deleted = lines.filter((l) => l.seq !== 2);
    expect(verifyChain(CO, deleted)).toMatchObject({ ok: false, brokenAtSeq: 3 });

    expect(verifyChain("22222222-2222-2222-2222-222222222222", lines)).toMatchObject({ ok: false, brokenAtSeq: 1 });
  });

  it("chains a reversal after the original without changing it", () => {
    const a = chainJournal(CO, receipt("t1", 1000_00), null);
    const originalHashes = a.lines.map((l) => l.hash);
    const rev = chainJournal(CO, buildReversal(toPosted(a), { id: "r1", date: "2026-03-16", reason: "dup" }), { seq: 2, hash: a.hash });
    expect(a.lines.map((l) => l.hash)).toEqual(originalHashes);
    expect(verifyChain(CO, store([a, rev])).ok).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { ageItems, bucketFor } from "./aging";
import { applyPayment, buildPaymentJournal, buildRecognitionJournal, PaymentError, statusFor } from "./payments";
import { accountBalances } from "@/lib/ledger/journal";

describe("aging", () => {
  it("buckets by days past due", () => {
    expect(bucketFor(-5)).toBe("current");
    expect(bucketFor(0)).toBe("current");
    expect(bucketFor(1)).toBe("1-30");
    expect(bucketFor(30)).toBe("1-30");
    expect(bucketFor(31)).toBe("31-60");
    expect(bucketFor(60)).toBe("31-60");
    expect(bucketFor(61)).toBe("61-90");
    expect(bucketFor(90)).toBe("61-90");
    expect(bucketFor(91)).toBe("90+");
  });

  it("ages open balances, skips paid and future-issued items, totals by party", () => {
    const r = ageItems(
      [
        { id: "a", party: "Acme", issue_date: "2026-01-01", due_date: "2026-01-31", amount: 1000_00, amount_paid: 400_00 },
        { id: "b", party: "Acme", issue_date: "2026-03-01", due_date: "2026-03-31", amount: 500_00, amount_paid: 0 },
        { id: "c", party: "Beta", issue_date: "2026-02-01", due_date: "2026-02-15", amount: 200_00, amount_paid: 200_00 },
        { id: "d", party: "Beta", issue_date: "2026-05-01", due_date: "2026-05-31", amount: 999_00, amount_paid: 0 },
        { id: "e", party: "Beta", issue_date: "2025-10-01", due_date: "2025-10-31", amount: 300_00, amount_paid: 0 },
      ],
      "2026-03-31",
    );
    expect(r.items.map((i) => [i.id, i.bucket, i.balance])).toEqual([
      ["e", "90+", 300_00],
      ["a", "31-60", 600_00],
      ["b", "current", 500_00],
    ]);
    expect(r.totals).toEqual({ current: 500_00, "1-30": 0, "31-60": 600_00, "61-90": 0, "90+": 300_00 });
    expect(r.total).toBe(1400_00);
    expect(r.byParty[0]).toMatchObject({ party: "Acme", total: 1100_00 });
  });
});

describe("payments", () => {
  it("moves status unpaid → partial → paid", () => {
    expect(statusFor(1000, 0)).toBe("unpaid");
    const p1 = applyPayment({ amount: 1000_00, amount_paid: 0 }, 250_00);
    expect(p1).toEqual({ amount_paid: 250_00, status: "partial", balance: 750_00 });
    const p2 = applyPayment({ amount: 1000_00, amount_paid: p1.amount_paid }, 750_00);
    expect(p2).toEqual({ amount_paid: 1000_00, status: "paid", balance: 0 });
  });

  it("rejects overpayment, zero and payments on paid documents", () => {
    expect(() => applyPayment({ amount: 100_00, amount_paid: 0 }, 100_01)).toThrow(PaymentError);
    expect(() => applyPayment({ amount: 100_00, amount_paid: 0 }, 0)).toThrow(PaymentError);
    expect(() => applyPayment({ amount: 100_00, amount_paid: 100_00 }, 1)).toThrow(/fully paid/);
  });

  it("invoice recognition + full collection clears AR", () => {
    const rec = buildRecognitionJournal("invoice",
      { id: "i1", party: "Acme", reference: "SI-001", issue_date: "2026-03-01", amount: 11200_00, vat_amount: 1200_00, account: "4000" }, "j1");
    const pay = buildPaymentJournal("invoice",
      { party: "Acme", reference: "SI-001", paid_on: "2026-03-20", amount: 11200_00, cash_account: "1010" }, "j2");
    const bal = accountBalances([...rec.lines, ...pay.lines]);
    expect(bal.get("1100")).toBe(0);
    expect(bal.get("1010")).toBe(11200_00);
    expect(bal.get("4000")).toBe(-10000_00);
    expect(bal.get("2100")).toBe(-1200_00);
  });

  it("bill recognition + partial payment leaves the open balance in AP", () => {
    const rec = buildRecognitionJournal("bill",
      { id: "b1", party: "Landlord", reference: "B-9", issue_date: "2026-03-01", amount: 20000_00, vat_amount: 0, account: "6100" }, "j1");
    expect(rec.lines).toHaveLength(2); // zero VAT line dropped
    const pay = buildPaymentJournal("bill",
      { party: "Landlord", reference: "B-9", paid_on: "2026-03-10", amount: 5000_00, cash_account: "1010" }, "j2");
    const bal = accountBalances([...rec.lines, ...pay.lines]);
    expect(bal.get("2000")).toBe(-15000_00);
    expect(bal.get("6100")).toBe(20000_00);
  });
});

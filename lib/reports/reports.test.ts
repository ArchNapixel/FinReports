import { describe, expect, it } from "vitest";
import { PH_STANDARD_COA } from "@/lib/ledger/chart-of-accounts";
import { buildSimpleJournal, buildCompoundJournal } from "@/lib/ledger/journal";
import type { JournalDraft } from "@/lib/ledger/types";
import { balanceSheet, cashFlowStatement, incomeStatement, trialBalance } from "./financial";
import { cashRegister, salesReport, salesSummary } from "./cash-and-sales";
import type { AccountRow, LedgerRow } from "./types";
import { businessTax, vatFromGross } from "@/lib/tax/business-tax";
import { form1601C, form1604C, form1701Q, form2316, type PayrollItemRow } from "@/lib/tax/bir-forms";

const accounts: AccountRow[] = PH_STANDARD_COA.map((a) => ({
  code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? "", is_cash: !!a.is_cash, cash_flow_class: a.cash_flow_class ?? "operating",
}));

let seq = 0;
function rows(...drafts: JournalDraft[]): LedgerRow[] {
  return drafts.flatMap((d) => d.lines.map((l) => ({
    transaction_id: d.id, seq: ++seq, entry_date: d.date, account_code: l.account_code, debit: l.debit, credit: l.credit,
    memo: l.memo ?? "", vendor: d.vendor, description: d.description, reference: d.reference ?? null, source: d.source,
  })));
}

const capital = buildCompoundJournal(
  { id: "c1", date: "2026-01-02", vendor: "Owner", description: "Initial capital", category: "3000", type: "credit", source: "manual" },
  [{ account_code: "1010", debit: 100000_00, credit: 0 }, { account_code: "3000", debit: 0, credit: 100000_00 }],
);
const sale1 = buildSimpleJournal({ id: "s1", date: "2026-01-15", vendor: "Acme", type: "credit", source: "manual", amount: 56000_00, vatAmount: 6000_00, categoryAccount: "4010", counterAccount: "1010", reference: "OR-1" });
const sale2 = buildSimpleJournal({ id: "s2", date: "2026-02-10", vendor: "Beta", type: "credit", source: "manual", amount: 22400_00, vatAmount: 2400_00, categoryAccount: "4000", counterAccount: "1000", reference: "OR-2" });
const rent = buildSimpleJournal({ id: "e1", date: "2026-01-31", vendor: "Landlord", type: "debit", source: "manual", amount: 15000_00, categoryAccount: "6100", counterAccount: "1010" });
const power = buildSimpleJournal({ id: "e2", date: "2026-02-05", vendor: "Meralco", type: "debit", source: "receipt", amount: 5600_00, vatAmount: 600_00, categoryAccount: "6110", counterAccount: "1010" });
const laptop = buildSimpleJournal({ id: "e3", date: "2026-02-20", vendor: "Laptop Store", type: "debit", source: "receipt", amount: 60000_00, categoryAccount: "1500", counterAccount: "1010" });
const transfer = buildCompoundJournal(
  { id: "x1", date: "2026-02-21", vendor: "", description: "Deposit", category: "1010", type: "debit", source: "manual" },
  [{ account_code: "1010", debit: 10000_00, credit: 0 }, { account_code: "1000", debit: 0, credit: 10000_00 }],
);
const lateSale = buildSimpleJournal({ id: "s3", date: "2026-04-10", vendor: "Acme", type: "credit", source: "manual", amount: 11200_00, vatAmount: 1200_00, categoryAccount: "4010", counterAccount: "1010" });

const ALL = rows(capital, sale1, sale2, rent, power, laptop, transfer, lateSale);
const Q1 = { from: "2026-01-01", to: "2026-03-31" };

describe("financial statements", () => {
  it("income statement for the period", () => {
    const is = incomeStatement(ALL, accounts, Q1);
    expect(is.revenue.total).toBe(70000_00);
    expect(is.expenses.total).toBe(20000_00);
    expect(is.netIncome).toBe(50000_00);
  });

  it("balance sheet balances and carries earnings to date", () => {
    const bs = balanceSheet(ALL, accounts, "2026-03-31");
    expect(bs.balanced).toBe(true);
    expect(bs.earningsToDate).toBe(50000_00);
    expect(bs.noncurrentAssets.total).toBe(60000_00);
    expect(bs.liabilities.total).toBe(8400_00); // output VAT; input VAT sits in assets
    expect(bs.totalAssets).toBe(bs.totalLiabilitiesAndEquity);
  });

  it("direct cash flow reconciles opening to closing and ignores transfers", () => {
    const cf = cashFlowStatement(ALL, accounts, { from: "2026-01-02", to: "2026-03-31" });
    expect(cf.opening).toBe(0);
    expect(cf.sections.financing.total).toBe(100000_00);
    expect(cf.sections.investing.total).toBe(-60000_00);
    expect(cf.sections.operating.total).toBe(56000_00 + 22400_00 - 15000_00 - 5600_00);
    expect(cf.closing).toBe(cf.opening + cf.netChange);
    const tb = trialBalance(ALL, accounts, "2026-03-31");
    const cash = tb.filter((r) => ["1000", "1010"].includes(r.code)).reduce((s, r) => s + r.debit - r.credit, 0);
    expect(cf.closing).toBe(cash);
  });

  it("trial balance debits equal credits", () => {
    const tb = trialBalance(ALL, accounts, "2026-12-31");
    expect(tb.reduce((s, r) => s + r.debit, 0)).toBe(tb.reduce((s, r) => s + r.credit, 0));
  });
});

describe("sales and cash registers", () => {
  it("itemizes sales with VAT and summarizes by customer/category/month", () => {
    const s = salesReport(ALL, accounts, Q1);
    expect(s.lines.map((l) => [l.customer, l.net, l.vat])).toEqual([["Acme", 50000_00, 6000_00], ["Beta", 20000_00, 2400_00]]);
    expect(s.totals.gross).toBe(78400_00);
    const sum = salesSummary(s.lines);
    expect(sum.byMonth.map((m) => m.key)).toEqual(["2026-01", "2026-02"]);
    expect(sum.byCategory[0].key).toBe("4010");
  });

  it("disbursements and receipts exclude inter-cash transfers", () => {
    const out = cashRegister(ALL, accounts, Q1, "out");
    expect(out.lines.map((l) => l.transaction_id)).toEqual(["e1", "e2", "e3"]);
    expect(out.total).toBe(80600_00);
    const inn = cashRegister(ALL, accounts, Q1, "in");
    expect(inn.lines.map((l) => l.transaction_id)).toEqual(["c1", "s1", "s2"]);
  });
});

describe("business tax", () => {
  it("splits VAT-inclusive amounts", () => {
    expect(vatFromGross(112_00)).toEqual({ net: 100_00, vat: 12_00 });
  });
  it("computes VAT payable from output and input VAT", () => {
    const t = businessTax(ALL, accounts, Q1, "vat");
    expect(t.vat).toMatchObject({ outputVat: 8400_00, inputVat: 600_00, vatPayable: 7800_00, variance: 0 });
  });
  it("computes 3% percentage tax for non-VAT", () => {
    const t = businessTax(ALL, accounts, Q1, "non_vat");
    expect(t.percentageTax?.due).toBe(2100_00);
  });
});

const annual = { brackets: [{ over: 0, base: 0, rate: 0 }, { over: 250000, base: 0, rate: 0.15 }, { over: 400000, base: 22500, rate: 0.2 }, { over: 800000, base: 102500, rate: 0.25 }, { over: 2000000, base: 402500, rate: 0.3 }, { over: 8000000, base: 2202500, rate: 0.35 }], eight_percent_exempt: 250000 };

describe("BIR forms", () => {
  const items: PayrollItemRow[] = Array.from({ length: 12 }, (_, i) => ({
    employee_id: "e1", period: `2026-${String(i + 1).padStart(2, "0")}`,
    gross: 40000_00, sss: 1750_00, philhealth: 1000_00, pagibig: 200_00, withholding_tax: 2618_40,
  }));
  const emp = { id: "e1", name: "Dela Cruz, Juan", TIN: "123-456-789-000" };

  it("1601-C nets mandatory contributions out of taxable compensation", () => {
    const f = form1601C(items, "2026-03");
    expect(f.totals).toMatchObject({ total: 40000_00, nonTaxable: 2950_00, taxable: 37050_00, withheld: 2618_40, due: 2618_40 });
    expect(f.fields.find((x) => x.item === "22")?.value).toBe(37050_00);
  });

  it("2316 annualizes and reports the year-end adjustment", () => {
    const f = form2316(items, emp, 2026, annual);
    expect(f.taxable).toBe(444600_00);
    expect(f.taxDue).toBe(22500_00 + 8920_00); // 22,500 + 20% × 44,600
    expect(f.withheld).toBe(31420_80);
    expect(f.adjustment).toBe(f.taxDue - f.withheld);
  });

  it("1604-C lists monthly remittances and the alphalist", () => {
    const f = form1604C(items, [emp, { id: "e2", name: "Unpaid", TIN: "" }], 2026, annual);
    expect(f.remittances).toHaveLength(12);
    expect(f.totalWithheld).toBe(31420_80);
    expect(f.alphalist.map((a) => a.employee.id)).toEqual(["e1"]);
  });

  it("1701Q computes cumulative graduated (OSD) and 8% options", () => {
    const osd = form1701Q({ rows: ALL, accounts, year: 2026, quarter: 1, option: "graduated_osd", taxType: "non_vat", annual });
    expect(osd.sales).toBe(70000_00);
    expect(osd.taxableIncome).toBe(42000_00);
    expect(osd.taxDue).toBe(0);
    const eight = form1701Q({ rows: ALL, accounts, year: 2026, quarter: 2, option: "eight_percent", taxType: "non_vat", annual });
    expect(eight.sales).toBe(80000_00);
    expect(eight.taxableIncome).toBe(0);
    const vatWarn = form1701Q({ rows: ALL, accounts, year: 2026, quarter: 1, option: "eight_percent", taxType: "vat", annual });
    expect(vatWarn.warnings.join(" ")).toMatch(/not available to VAT/);
  });
});

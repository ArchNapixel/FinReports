import { describe, expect, it } from "vitest";
import { computePagIbig, computePayrollLine, computePhilHealth, computeSss, graduatedTax, sumPayroll } from "./compute";
import { resolveTables, type StatutoryRow } from "./tables";
import { buildPayrollJournal } from "./journal";
import { totals } from "@/lib/ledger/journal";

// Mirrors supabase/migrations/0002_statutory_seed.sql.
const ROWS: StatutoryRow[] = [
  { kind: "sss", effective_from: "2023-01-01", effective_to: "2024-12-31", payload: { ee_rate: 0.045, er_rate: 0.095, msc_min: 4000, msc_max: 30000, msc_step: 500, ec_threshold: 15000, ec_low: 10, ec_high: 30 } },
  { kind: "sss", effective_from: "2025-01-01", effective_to: null, payload: { ee_rate: 0.05, er_rate: 0.1, msc_min: 5000, msc_max: 35000, msc_step: 500, ec_threshold: 15000, ec_low: 10, ec_high: 30 } },
  { kind: "philhealth", effective_from: "2024-01-01", effective_to: null, payload: { rate: 0.05, floor: 10000, ceiling: 100000, ee_share: 0.5 } },
  { kind: "pagibig", effective_from: "2024-02-01", effective_to: null, payload: { ee_rate: 0.02, ee_rate_low: 0.01, low_threshold: 1500, er_rate: 0.02, max_fund_salary: 10000 } },
  { kind: "wtax_monthly", effective_from: "2023-01-01", effective_to: null, payload: { brackets: [{ over: 0, base: 0, rate: 0 }, { over: 20833, base: 0, rate: 0.15 }, { over: 33333, base: 1875, rate: 0.2 }, { over: 66667, base: 8541.8, rate: 0.25 }, { over: 166667, base: 33541.8, rate: 0.3 }, { over: 666667, base: 183541.8, rate: 0.35 }] } },
  { kind: "wtax_annual", effective_from: "2023-01-01", effective_to: null, payload: { brackets: [{ over: 0, base: 0, rate: 0 }, { over: 250000, base: 0, rate: 0.15 }, { over: 400000, base: 22500, rate: 0.2 }, { over: 800000, base: 102500, rate: 0.25 }, { over: 2000000, base: 402500, rate: 0.3 }, { over: 8000000, base: 2202500, rate: 0.35 }] } },
];

const T2026 = resolveTables(ROWS, "2026-03-31");

describe("versioned tables", () => {
  it("resolves the row effective on the pay date", () => {
    expect(resolveTables(ROWS, "2024-06-30").sss.ee_rate).toBe(0.045);
    expect(T2026.sss.ee_rate).toBe(0.05);
  });
  it("fails loudly when no table covers the date", () => {
    expect(() => resolveTables(ROWS, "2022-12-31")).toThrow(/No sss table/);
  });
});

describe("SSS (2025 schedule)", () => {
  it("applies MSC floor, rounding bands and ceiling", () => {
    expect(computeSss(4000_00, T2026.sss)).toEqual({ msc: 5000_00, ee: 250_00, er: 500_00, ec: 10_00 });
    expect(computeSss(5249_99, T2026.sss).msc).toBe(5000_00);
    expect(computeSss(5250_00, T2026.sss).msc).toBe(5500_00);
    expect(computeSss(25000_00, T2026.sss)).toEqual({ msc: 25000_00, ee: 1250_00, er: 2500_00, ec: 30_00 });
    expect(computeSss(80000_00, T2026.sss)).toEqual({ msc: 35000_00, ee: 1750_00, er: 3500_00, ec: 30_00 });
  });
});

describe("PhilHealth (5%)", () => {
  it("splits premium 50/50 within floor and ceiling", () => {
    expect(computePhilHealth(8000_00, T2026.philhealth)).toEqual({ premium: 500_00, ee: 250_00, er: 250_00 });
    expect(computePhilHealth(30000_00, T2026.philhealth)).toEqual({ premium: 1500_00, ee: 750_00, er: 750_00 });
    expect(computePhilHealth(150000_00, T2026.philhealth)).toEqual({ premium: 5000_00, ee: 2500_00, er: 2500_00 });
  });
});

describe("Pag-IBIG", () => {
  it("caps at the ₱10,000 fund salary and uses 1% EE rate at ≤₱1,500", () => {
    expect(computePagIbig(1500_00, T2026.pagibig)).toEqual({ ee: 15_00, er: 30_00 });
    expect(computePagIbig(8000_00, T2026.pagibig)).toEqual({ ee: 160_00, er: 160_00 });
    expect(computePagIbig(50000_00, T2026.pagibig)).toEqual({ ee: 200_00, er: 200_00 });
  });
});

describe("withholding tax (TRAIN, 2023+)", () => {
  it("computes monthly graduated tax at bracket edges", () => {
    expect(graduatedTax(20833_00, T2026.wtax_monthly)).toBe(0);
    expect(graduatedTax(25000_00, T2026.wtax_monthly)).toBe(625_05); // 15% × 4,167
    expect(graduatedTax(50000_00, T2026.wtax_monthly)).toBe(5208_40); // 1,875 + 20% × 16,667
    expect(graduatedTax(100000_00, T2026.wtax_monthly)).toBe(16875_05); // 8,541.80 + 25% × 33,333
  });
  it("computes annual graduated tax", () => {
    expect(graduatedTax(250000_00, T2026.wtax_annual)).toBe(0);
    expect(graduatedTax(500000_00, T2026.wtax_annual)).toBe(42500_00);
    expect(graduatedTax(1000000_00, T2026.wtax_annual)).toBe(152500_00);
  });
});

describe("payroll line and journal", () => {
  it("nets statutory deductions and tax from gross", () => {
    const l = computePayrollLine({ id: "e1", monthly_salary: 40000_00 }, T2026);
    expect(l).toMatchObject({ sss_ee: 1750_00, philhealth_ee: 1000_00, pagibig_ee: 200_00 }); // MSC capped at 35,000
    expect(l.taxable).toBe(37050_00);
    expect(l.withholding_tax).toBe(1875_00 + 743_40); // 1,875 + 20% × 3,717
    expect(l.net_pay).toBe(40000_00 - 1750_00 - 1000_00 - 200_00 - 2618_40);
  });

  it("posts a balanced payroll accrual", () => {
    const lines = [
      computePayrollLine({ id: "e1", monthly_salary: 40000_00 }, T2026),
      computePayrollLine({ id: "e2", monthly_salary: 18000_00 }, T2026),
    ];
    const t = sumPayroll(lines);
    const j = buildPayrollJournal("2026-03", "2026-03-31", t, "j1");
    const tt = totals(j.lines);
    expect(tt.debit).toBe(tt.credit);
    expect(tt.debit).toBe(t.gross + t.sss_er + t.sss_ec + t.philhealth_er + t.pagibig_er);
  });
});

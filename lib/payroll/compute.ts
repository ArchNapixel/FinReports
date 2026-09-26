import { applyRate, fromCentavos, toCentavos, type Centavos } from "@/lib/money";
import type { PagIbigTable, PhilHealthTable, SssTable, StatutoryTables, WtaxTable } from "./tables";

export interface SssResult { msc: Centavos; ee: Centavos; er: Centavos; ec: Centavos }

export function computeSss(monthlyComp: Centavos, t: SssTable): SssResult {
  const salary = fromCentavos(monthlyComp);
  const steps = Math.floor((salary - t.msc_min + t.msc_step / 2) / t.msc_step);
  const mscPesos = Math.min(t.msc_max, Math.max(t.msc_min, t.msc_min + steps * t.msc_step));
  const msc = toCentavos(mscPesos);
  return {
    msc,
    ee: applyRate(msc, t.ee_rate),
    er: applyRate(msc, t.er_rate),
    ec: toCentavos(mscPesos < t.ec_threshold ? t.ec_low : t.ec_high),
  };
}

export function computePhilHealth(monthlyBasic: Centavos, t: PhilHealthTable): { ee: Centavos; er: Centavos; premium: Centavos } {
  const base = Math.min(toCentavos(t.ceiling), Math.max(toCentavos(t.floor), monthlyBasic));
  const premium = applyRate(base, t.rate);
  const ee = applyRate(premium, t.ee_share);
  return { premium, ee, er: premium - ee };
}

export function computePagIbig(monthlyComp: Centavos, t: PagIbigTable): { ee: Centavos; er: Centavos } {
  const base = Math.min(monthlyComp, toCentavos(t.max_fund_salary));
  const eeRate = monthlyComp <= toCentavos(t.low_threshold) ? t.ee_rate_low : t.ee_rate;
  return { ee: applyRate(base, eeRate), er: applyRate(base, t.er_rate) };
}

/** Graduated tax: base + rate × (taxable − over) for the bracket it falls in. */
export function graduatedTax(taxable: Centavos, t: WtaxTable): Centavos {
  if (taxable <= 0) return 0;
  const brackets = [...t.brackets].sort((a, b) => b.over - a.over);
  const b = brackets.find((x) => taxable > toCentavos(x.over)) ?? brackets[brackets.length - 1];
  return toCentavos(b.base) + applyRate(taxable - toCentavos(b.over), b.rate);
}

export interface PayrollLine {
  employee_id: string;
  gross: Centavos;
  sss_ee: Centavos;
  sss_er: Centavos;
  sss_ec: Centavos;
  philhealth_ee: Centavos;
  philhealth_er: Centavos;
  pagibig_ee: Centavos;
  pagibig_er: Centavos;
  taxable: Centavos;
  withholding_tax: Centavos;
  net_pay: Centavos;
}

/** Monthly payroll for one employee (regular compensation, monthly cycle). */
export function computePayrollLine(employee: { id: string; monthly_salary: Centavos }, tables: StatutoryTables): PayrollLine {
  const gross = employee.monthly_salary;
  const sss = computeSss(gross, tables.sss);
  const ph = computePhilHealth(gross, tables.philhealth);
  const hdmf = computePagIbig(gross, tables.pagibig);
  // Mandatory employee contributions are excluded from taxable compensation.
  const taxable = Math.max(0, gross - sss.ee - ph.ee - hdmf.ee);
  const wtax = graduatedTax(taxable, tables.wtax_monthly);
  return {
    employee_id: employee.id,
    gross,
    sss_ee: sss.ee,
    sss_er: sss.er,
    sss_ec: sss.ec,
    philhealth_ee: ph.ee,
    philhealth_er: ph.er,
    pagibig_ee: hdmf.ee,
    pagibig_er: hdmf.er,
    taxable,
    withholding_tax: wtax,
    net_pay: gross - sss.ee - ph.ee - hdmf.ee - wtax,
  };
}

export interface PayrollTotals {
  gross: Centavos;
  sss_ee: Centavos;
  sss_er: Centavos;
  sss_ec: Centavos;
  philhealth_ee: Centavos;
  philhealth_er: Centavos;
  pagibig_ee: Centavos;
  pagibig_er: Centavos;
  withholding_tax: Centavos;
  net_pay: Centavos;
}

export function sumPayroll(lines: Omit<PayrollLine, "employee_id" | "taxable">[]): PayrollTotals {
  const keys: (keyof PayrollTotals)[] = [
    "gross", "sss_ee", "sss_er", "sss_ec", "philhealth_ee", "philhealth_er", "pagibig_ee", "pagibig_er", "withholding_tax", "net_pay",
  ];
  const t = Object.fromEntries(keys.map((k) => [k, 0])) as unknown as PayrollTotals;
  for (const l of lines) for (const k of keys) t[k] += l[k];
  return t;
}

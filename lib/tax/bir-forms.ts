import { applyRate, toCentavos, type Centavos } from "@/lib/money";
import { graduatedTax } from "@/lib/payroll/compute";
import type { WtaxTable } from "@/lib/payroll/tables";
import type { AccountRow, LedgerRow } from "@/lib/reports/types";
import { businessTax, type BusinessTaxSummary } from "./business-tax";

/**
 * Field values for BIR returns. Each field carries the item label printed
 * on the form so the PDF and the eBIRForms key-in sheet line up. The app
 * never files — the accountant reviews and files these.
 */
export interface FormField { item: string; label: string; value: Centavos | string }

export interface PayrollItemRow {
  employee_id: string;
  period: string; // YYYY-MM
  gross: Centavos;
  sss: Centavos;
  philhealth: Centavos;
  pagibig: Centavos;
  withholding_tax: Centavos;
}

export interface EmployeeRow { id: string; name: string; TIN: string }

// ─────────────────────────────────────────────────────────── 1601-C (monthly)
export function form1601C(items: PayrollItemRow[], period: string, priorRemittance: Centavos = 0) {
  const month = items.filter((i) => i.period === period);
  const total = month.reduce((s, i) => s + i.gross, 0);
  const contributions = month.reduce((s, i) => s + i.sss + i.philhealth + i.pagibig, 0);
  const nonTaxable = contributions;
  const taxable = total - nonTaxable;
  const withheld = month.reduce((s, i) => s + i.withholding_tax, 0);
  const due = withheld - priorRemittance;
  const fields: FormField[] = [
    { item: "3", label: "For the Month (MM/YYYY)", value: `${period.slice(5, 7)}/${period.slice(0, 4)}` },
    { item: "14", label: "Total Amount of Compensation", value: total },
    { item: "15", label: "Statutory Minimum Wage (MWEs)", value: 0 },
    { item: "16", label: "Holiday Pay, Overtime Pay, Night Shift Differential and Hazard Pay (MWEs)", value: 0 },
    { item: "17", label: "13th Month Pay and Other Benefits", value: 0 },
    { item: "18", label: "De Minimis Benefits", value: 0 },
    { item: "19", label: "SSS, GSIS, PHIC, HDMF Mandatory Contributions & Union Dues (employee's share)", value: contributions },
    { item: "20", label: "Other Non-Taxable Compensation", value: 0 },
    { item: "21", label: "Total Non-Taxable Compensation (Sum of Items 15 to 20)", value: nonTaxable },
    { item: "22", label: "Total Taxable Compensation (Item 14 less Item 21)", value: taxable },
    { item: "23", label: "Less: Taxable Compensation Not Subject to Withholding Tax", value: 0 },
    { item: "24", label: "Net Taxable Compensation (Item 22 less Item 23)", value: taxable },
    { item: "25", label: "Total Taxes Withheld", value: withheld },
    { item: "26", label: "Add/(Less): Adjustment of Taxes Withheld from Previous Month/s", value: 0 },
    { item: "27", label: "Taxes Withheld for Remittance (Sum of Items 25 and 26)", value: withheld },
    { item: "28", label: "Less: Tax Remitted in Return Previously Filed, if amended", value: priorRemittance },
    { item: "30", label: "Total Tax Remittances Made", value: priorRemittance },
    { item: "31", label: "Tax Still Due/(Over-remittance)", value: due },
  ];
  return { form: "1601-C" as const, period, employees: new Set(month.map((i) => i.employee_id)).size, fields, totals: { total, nonTaxable, taxable, withheld, due } };
}

// ─────────────────────────────────────────────── 2316 (per employee, annual)
export interface Form2316 {
  form: "2316";
  year: number;
  employee: EmployeeRow;
  fields: FormField[];
  gross: Centavos;
  nonTaxable: Centavos;
  taxable: Centavos;
  taxDue: Centavos;
  withheld: Centavos;
  adjustment: Centavos; // positive = under-withheld (collect), negative = refund
}

export function form2316(items: PayrollItemRow[], employee: EmployeeRow, year: number, annual: WtaxTable): Form2316 {
  const mine = items.filter((i) => i.employee_id === employee.id && i.period.startsWith(`${year}-`));
  const gross = mine.reduce((s, i) => s + i.gross, 0);
  const contributions = mine.reduce((s, i) => s + i.sss + i.philhealth + i.pagibig, 0);
  const nonTaxable = contributions;
  const taxable = gross - nonTaxable;
  const taxDue = graduatedTax(taxable, annual);
  const withheld = mine.reduce((s, i) => s + i.withholding_tax, 0);
  const fields: FormField[] = [
    { item: "1", label: "For the Year", value: String(year) },
    { item: "6", label: "Employee TIN", value: employee.TIN },
    { item: "7", label: "Employee's Name", value: employee.name },
    { item: "19", label: "Gross Compensation Income from Present Employer", value: gross },
    { item: "20", label: "Less: Total Non-Taxable/Exempt Compensation from Present Employer", value: nonTaxable },
    { item: "21", label: "Taxable Compensation Income from Present Employer", value: taxable },
    { item: "22", label: "Add: Taxable Compensation Income from Previous Employer, if applicable", value: 0 },
    { item: "23", label: "Gross Taxable Compensation Income", value: taxable },
    { item: "24", label: "Tax Due", value: taxDue },
    { item: "25A", label: "Amount of Taxes Withheld — Present Employer", value: withheld },
    { item: "25B", label: "Amount of Taxes Withheld — Previous Employer", value: 0 },
    { item: "26", label: "Total Amount of Taxes Withheld as Adjusted", value: withheld },
    { item: "34", label: "SSS, GSIS, PHIC & Pag-IBIG Contributions and Union Dues (Employee share only)", value: contributions },
    { item: "36", label: "Total Non-Taxable/Exempt Compensation Income", value: nonTaxable },
    { item: "37", label: "Basic Salary", value: gross },
  ];
  return { form: "2316", year, employee, fields, gross, nonTaxable, taxable, taxDue, withheld, adjustment: taxDue - withheld };
}

// ─────────────────────────────────────────── 1604-C (annual information)
export function form1604C(items: PayrollItemRow[], employees: EmployeeRow[], year: number, annual: WtaxTable) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const remittances = months.map((m) => {
    const withheld = items.filter((i) => i.period === m).reduce((s, i) => s + i.withholding_tax, 0);
    return { month: m, taxesWithheld: withheld, adjustment: 0, total: withheld };
  });
  const alphalist = employees
    .map((e) => form2316(items, e, year, annual))
    .filter((f) => f.gross > 0)
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  return {
    form: "1604-C" as const,
    year,
    remittances,
    totalWithheld: remittances.reduce((s, r) => s + r.total, 0),
    alphalist,
    // Year-end adjustment totals for Schedule 1 (employees as of Dec 31).
    totals: {
      gross: alphalist.reduce((s, a) => s + a.gross, 0),
      nonTaxable: alphalist.reduce((s, a) => s + a.nonTaxable, 0),
      taxable: alphalist.reduce((s, a) => s + a.taxable, 0),
      taxDue: alphalist.reduce((s, a) => s + a.taxDue, 0),
      withheld: alphalist.reduce((s, a) => s + a.withheld, 0),
    },
  };
}

// ─────────────────────────────────────── 1701Q (individual, quarterly)
export type IncomeTaxOption = "graduated_itemized" | "graduated_osd" | "eight_percent";

export interface Form1701QInput {
  rows: LedgerRow[];
  accounts: AccountRow[];
  year: number;
  quarter: 1 | 2 | 3;
  option: IncomeTaxOption;
  taxType: "vat" | "non_vat";
  annual: WtaxTable;
  /** Income tax paid in previous quarters of the same year. */
  priorQuarterPayments?: Centavos;
  /** Creditable withholding (Form 2307) received this year to date. */
  creditableWithholding?: Centavos;
}

/**
 * Cumulative (Jan 1 → quarter end) computation, as 1701Q requires. The
 * graduated options apply the annual table to cumulative taxable income; the
 * 8% option applies to cumulative gross sales/receipts plus other
 * non-operating income in excess of ₱250,000.
 */
export function form1701Q(input: Form1701QInput) {
  const { rows, accounts, year, quarter, option, annual } = input;
  const qEnd = ["03-31", "06-30", "09-30"][quarter - 1];
  const period = { from: `${year}-01-01`, to: `${year}-${qEnd}` };
  const acc = new Map(accounts.map((a) => [a.code, a]));
  const pr = rows.filter((r) => r.entry_date >= period.from && r.entry_date <= period.to);
  const sumType = (t: string, credit: boolean, pred: (r: LedgerRow) => boolean = () => true) =>
    pr.filter((r) => acc.get(r.account_code)?.type === t && pred(r)).reduce((s, r) => s + (credit ? r.credit - r.debit : r.debit - r.credit), 0);

  const sales = sumType("revenue", true, (r) => !r.account_code.startsWith("49"));
  const otherIncome = sumType("revenue", true, (r) => r.account_code.startsWith("49"));
  const costOfSales = sumType("cost_of_sales", false);
  const itemized = sumType("expense", false);
  const grossIncome = sales - costOfSales;

  const warnings: string[] = [];
  let taxableIncome: Centavos;
  let taxDue: Centavos;
  let deductions: Centavos = 0;
  if (option === "eight_percent") {
    if (input.taxType === "vat") warnings.push("8% option is not available to VAT-registered taxpayers.");
    if (sales + otherIncome > toCentavos(3_000_000)) warnings.push("Gross sales/receipts exceed ₱3M; 8% option is no longer available.");
    const exempt = toCentavos(annual.eight_percent_exempt ?? 250_000);
    taxableIncome = Math.max(0, sales + otherIncome - exempt);
    taxDue = applyRate(taxableIncome, 0.08);
  } else {
    // OSD for individuals is 40% of gross sales/receipts (NIRC Sec. 34(L)).
    deductions = option === "graduated_osd" ? applyRate(sales, 0.4) : itemized;
    taxableIncome = Math.max(0, (option === "graduated_osd" ? sales : grossIncome) - deductions + otherIncome);
    taxDue = graduatedTax(taxableIncome, annual);
  }
  const prior = input.priorQuarterPayments ?? 0;
  const cwt = input.creditableWithholding ?? 0;
  const payable = taxDue - prior - cwt;

  // Business tax is for the quarter itself, not the cumulative period.
  const qStart = ["01-01", "04-01", "07-01"][quarter - 1];
  const business: BusinessTaxSummary = businessTax(rows, accounts, { from: `${year}-${qStart}`, to: period.to }, input.taxType);
  if (option === "eight_percent" && business.percentageTax) {
    warnings.push("8% option is in lieu of percentage tax — no 2551Q is due for this quarter.");
  }
  // Line references follow the order of Schedules I/II and Part III of the
  // form; confirm against the current eBIRForms revision before keying in.
  const fields: FormField[] = [
    { item: "Yr", label: "For the Year", value: String(year) },
    { item: "Qtr", label: "Quarter", value: `Q${quarter}` },
    { item: "Opt", label: "Tax Rate / Method of Deduction", value: option === "eight_percent" ? "8% in lieu of graduated rates and percentage tax" : option === "graduated_osd" ? "Graduated rates — Optional Standard Deduction (40%)" : "Graduated rates — Itemized Deductions" },
    { item: "A", label: "Sales/Revenues/Receipts/Fees (cumulative)", value: sales },
    { item: "B", label: "Less: Cost of Sales/Services", value: option === "graduated_itemized" ? costOfSales : 0 },
    { item: "C", label: "Gross Income/(Loss) from Operation", value: option === "graduated_itemized" ? grossIncome : sales },
    { item: "D", label: "Less: Allowable Itemized Deductions / OSD", value: deductions },
    { item: "E", label: "Add: Other Non-Operating Income", value: otherIncome },
    { item: "F", label: option === "eight_percent" ? "Less: Allowable reduction (₱250,000)" : "—", value: option === "eight_percent" ? toCentavos(annual.eight_percent_exempt ?? 250_000) : 0 },
    { item: "G", label: "Taxable Income to Date", value: taxableIncome },
    { item: "H", label: "Tax Due", value: taxDue },
    { item: "I", label: "Less: Tax Payments for Previous Quarter(s) of the Same Year", value: prior },
    { item: "J", label: "Less: Creditable Tax Withheld (BIR Form 2307)", value: cwt },
    { item: "K", label: "Tax Payable/(Overpayment)", value: payable },
  ];
  return { form: "1701Q" as const, year, quarter, option, period, sales, otherIncome, costOfSales, itemized, grossIncome, deductions, taxableIncome, taxDue, payable, business, warnings, fields };
}

import { z } from "zod";
import { formatPeso, toCentavos } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/dates";
import { AGING_BUCKETS, ageItems, type OpenItem } from "@/lib/arap/aging";
import { balanceSheet, cashFlowStatement, incomeStatement, type StatementSection } from "./financial";
import { cashRegister, salesReport, salesSummary, type SummaryRow } from "./cash-and-sales";
import type { Column, ReportModel, Section } from "./model";
import type { AccountRow, CompanyHeader, LedgerRow } from "./types";
import { businessTax, PERCENTAGE_TAX_RATE, VAT_RATE } from "@/lib/tax/business-tax";
import { form1601C, form1604C, form1701Q, form2316, type EmployeeRow, type FormField, type PayrollItemRow } from "@/lib/tax/bir-forms";
import type { StatutoryTables } from "@/lib/payroll/tables";

export const REPORT_TYPES = [
  "financial", "sales", "sales-summary", "ap", "ar", "disbursements", "cash-receipts",
  "bir-1601c", "bir-2316", "bir-1604c", "bir-1701q", "business-tax",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_LABELS: Record<ReportType, string> = {
  financial: "Financial Report",
  sales: "Sales Report",
  "sales-summary": "Summary of Sales",
  ap: "Accounts Payable Aging",
  ar: "Accounts Receivable Aging",
  disbursements: "Disbursement Report",
  "cash-receipts": "Cash Receipts Report",
  "bir-1601c": "BIR 1601-C",
  "bir-2316": "BIR 2316",
  "bir-1604c": "BIR 1604-C",
  "bir-1701q": "BIR 1701Q",
  "business-tax": "VAT / Percentage Tax",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const ReportParams = z.object({
  type: z.enum(REPORT_TYPES),
  client_company_id: z.string().uuid(),
  from: isoDate,
  to: isoDate,
  format: z.enum(["pdf", "xlsx", "json"]).default("pdf"),
  narrative: z.coerce.boolean().default(false),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  quarter: z.coerce.number().int().min(1).max(3).optional(),
  option: z.enum(["graduated_itemized", "graduated_osd", "eight_percent"]).default("graduated_osd"),
  employee_id: z.string().uuid().optional(),
  cwt: z.coerce.number().min(0).default(0),
  prior_payments: z.coerce.number().min(0).default(0),
}).refine((p) => p.from <= p.to, { message: "from must be on or before to" });
export type ReportParams = z.infer<typeof ReportParams>;

export interface DocRow extends OpenItem { payments: { paid_on: string; amount: number }[] }

export interface ReportData {
  company: CompanyHeader;
  accounts: AccountRow[];
  ledger: () => Promise<LedgerRow[]>;
  invoices: () => Promise<DocRow[]>;
  bills: () => Promise<DocRow[]>;
  payrollItems: (yearPrefix: string) => Promise<PayrollItemRow[]>;
  employees: () => Promise<EmployeeRow[]>;
  tables: (onDate: string) => Promise<StatutoryTables>;
  narrative: (args: { company: string; is: ReturnType<typeof incomeStatement>; prior: ReturnType<typeof incomeStatement> | null; bs: ReturnType<typeof balanceSheet>; cf: ReturnType<typeof cashFlowStatement> }) => Promise<string | null>;
}

const moneyCol = (key: string, label: string, width = 1): Column => ({ key, label, money: true, align: "right", width });

function statementRows(s: StatementSection, sign = 1) {
  return s.lines.map((l) => ({ code: l.code, name: l.name, amount: l.amount * sign }));
}

const STATEMENT_COLS: Column[] = [
  { key: "code", label: "Code", width: 0.6 },
  { key: "name", label: "Account", width: 3 },
  moneyCol("amount", "Amount", 1.4),
];

function header(c: CompanyHeader) {
  return { name: c.name, TIN: c.TIN, address: c.registered_address, rdo: c.rdo_code };
}

function base(type: ReportType, c: CompanyHeader, periodLabel: string, fileSuffix: string): Omit<ReportModel, "sections"> {
  const slug = c.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return { type, title: REPORT_LABELS[type], company: header(c), periodLabel, generatedAt: todayISO(), filename: `${slug}-${type}-${fileSuffix}` };
}

const range = (p: ReportParams) => `${formatDate(p.from)} – ${formatDate(p.to)}`;

function formSection(fields: FormField[], heading?: string): Section {
  return {
    heading,
    variant: "form",
    columns: [{ key: "item", label: "Item", width: 0.6 }, { key: "label", label: "Description", width: 4 }, { key: "value", label: "Amount", align: "right", width: 1.4 }],
    rows: fields.map((f) => ({ item: f.item, label: f.label, value: f.value })),
  };
}

/** Money values in form sections are numbers (centavos); strings print as-is. */
export const FORM_MONEY_KEY = "value";

function asOfDocs(docs: DocRow[], p: ReportParams): OpenItem[] {
  return docs
    .filter((d) => d.issue_date >= p.from && d.issue_date <= p.to)
    .map((d) => ({ ...d, amount_paid: d.payments.filter((x) => x.paid_on <= p.to).reduce((s, x) => s + x.amount, 0) }));
}

export async function buildReport(p: ReportParams, d: ReportData): Promise<ReportModel> {
  const c = d.company;
  const suffix = `${p.from}_${p.to}`;

  switch (p.type) {
    case "financial": {
      const rows = await d.ledger();
      const is = incomeStatement(rows, d.accounts, p);
      const bs = balanceSheet(rows, d.accounts, p.to);
      const cf = cashFlowStatement(rows, d.accounts, p);
      let narrative: string | null = null;
      if (p.narrative) {
        const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000);
        const priorTo = new Date(Date.parse(p.from) - 86_400_000).toISOString().slice(0, 10);
        const priorFrom = new Date(Date.parse(priorTo) - days * 86_400_000).toISOString().slice(0, 10);
        const prior = incomeStatement(rows, d.accounts, { from: priorFrom, to: priorTo });
        narrative = await d.narrative({ company: c.name, is, prior: prior.revenue.lines.length || prior.expenses.lines.length ? prior : null, bs, cf });
      }
      const sections: Section[] = [
        { heading: "Statement of Comprehensive Income", columns: STATEMENT_COLS, rows: [], note: `For the period ${range(p)}` },
        { heading: "Revenue", columns: STATEMENT_COLS, rows: statementRows(is.revenue), totals: [{ name: "Total Revenue", amount: is.revenue.total }] },
        { heading: "Cost of Sales", columns: STATEMENT_COLS, rows: statementRows(is.costOfSales), totals: [{ name: "Gross Profit", amount: is.grossProfit }] },
        { heading: "Operating Expenses", columns: STATEMENT_COLS, rows: statementRows(is.expenses), totals: [{ name: "Total Operating Expenses", amount: is.expenses.total }, { name: "Net Income / (Loss)", amount: is.netIncome }] },
        { heading: "Statement of Financial Position", columns: STATEMENT_COLS, rows: [], note: `As of ${formatDate(p.to)}` },
        { heading: "Current Assets", columns: STATEMENT_COLS, rows: statementRows(bs.currentAssets), totals: [{ name: "Total Current Assets", amount: bs.currentAssets.total }] },
        { heading: "Non-current Assets", columns: STATEMENT_COLS, rows: statementRows(bs.noncurrentAssets), totals: [{ name: "Total Assets", amount: bs.totalAssets }] },
        { heading: "Liabilities", columns: STATEMENT_COLS, rows: statementRows(bs.liabilities), totals: [{ name: "Total Liabilities", amount: bs.liabilities.total }] },
        {
          heading: "Equity", columns: STATEMENT_COLS,
          rows: [...statementRows(bs.equity), { code: "", name: "Earnings to date (unclosed)", amount: bs.earningsToDate }],
          totals: [{ name: "Total Equity", amount: bs.equity.total + bs.earningsToDate }, { name: "Total Liabilities and Equity", amount: bs.totalLiabilitiesAndEquity }],
        },
        { heading: "Statement of Cash Flows (direct method)", columns: STATEMENT_COLS, rows: [], note: `For the period ${range(p)}` },
        ...(["operating", "investing", "financing"] as const).map((k) => ({
          heading: cf.sections[k].title, columns: STATEMENT_COLS, rows: statementRows(cf.sections[k]),
          totals: [{ name: `Net cash from ${k} activities`, amount: cf.sections[k].total }],
        })),
        {
          columns: STATEMENT_COLS, rows: [],
          totals: [
            { name: "Net increase / (decrease) in cash", amount: cf.netChange },
            { name: "Cash at beginning of period", amount: cf.opening },
            { name: "Cash at end of period", amount: cf.closing },
          ],
        },
      ];
      return {
        ...base("financial", c, range(p), suffix), sections, narrative,
        warnings: bs.balanced ? [] : [`Balance sheet is out of balance by ${formatPeso(bs.totalAssets - bs.totalLiabilitiesAndEquity)} — check the ledger chain.`],
      };
    }

    case "sales": {
      const s = salesReport(await d.ledger(), d.accounts, p);
      return {
        ...base("sales", c, range(p), suffix),
        sections: [{
          columns: [
            { key: "date", label: "Date", width: 0.9 }, { key: "reference", label: "Ref", width: 0.9 }, { key: "customer", label: "Customer", width: 1.8 },
            { key: "account", label: "Category", width: 1.6 }, moneyCol("net", "Net"), moneyCol("vat", "VAT"), moneyCol("gross", "Gross"),
          ],
          rows: s.lines.map((l) => ({ date: formatDate(l.date), reference: l.reference, customer: l.customer, account: l.account_name, net: l.net, vat: l.vat, gross: l.gross })),
          totals: [{ customer: `Total (${s.lines.length} lines)`, ...s.totals }],
        }],
      };
    }

    case "sales-summary": {
      const s = salesReport(await d.ledger(), d.accounts, p);
      const sum = salesSummary(s.lines);
      const sec = (heading: string, rows: SummaryRow[]): Section => ({
        heading,
        columns: [{ key: "label", label: heading.replace("By ", ""), width: 2.5 }, { key: "count", label: "Lines", align: "right", width: 0.6 }, moneyCol("net", "Net"), moneyCol("vat", "VAT"), moneyCol("gross", "Gross")],
        rows: rows.map((r) => ({ label: r.label, count: r.count, net: r.net, vat: r.vat, gross: r.gross })),
        totals: [{ label: "Total", count: s.lines.length, ...s.totals }],
      });
      return { ...base("sales-summary", c, range(p), suffix), sections: [sec("By Category", sum.byCategory), sec("By Customer", sum.byCustomer), sec("By Month", sum.byMonth)] };
    }

    case "ar":
    case "ap": {
      const docs = p.type === "ar" ? await d.invoices() : await d.bills();
      const aging = ageItems(asOfDocs(docs, p), p.to);
      const bucketCols = AGING_BUCKETS.map((b) => moneyCol(b, b === "current" ? "Current" : `${b} days`));
      const party = p.type === "ar" ? "Customer" : "Vendor";
      return {
        ...base(p.type, c, `As of ${formatDate(p.to)} (issued ${range(p)})`, p.to),
        sections: [
          {
            heading: `Summary by ${party}`,
            columns: [{ key: "party", label: party, width: 2.2 }, ...bucketCols, moneyCol("total", "Total")],
            rows: aging.byParty.map((r) => ({ party: r.party, ...r.totals, total: r.total })),
            totals: [{ party: "Total", ...aging.totals, total: aging.total }],
          },
          {
            heading: "Open Items",
            columns: [
              { key: "party", label: party, width: 1.8 }, { key: "reference", label: "Ref", width: 0.9 }, { key: "issue", label: "Issued", width: 0.9 },
              { key: "due", label: "Due", width: 0.9 }, { key: "days", label: "Days", align: "right", width: 0.5 }, { key: "bucket", label: "Bucket", width: 0.7 },
              moneyCol("amount", "Amount"), moneyCol("paid", "Paid"), moneyCol("balance", "Balance"),
            ],
            rows: aging.items.map((i) => ({
              party: i.party, reference: i.reference ?? "", issue: formatDate(i.issue_date), due: formatDate(i.due_date), days: i.days_overdue,
              bucket: i.bucket, amount: i.amount, paid: i.amount_paid, balance: i.balance,
            })),
          },
        ],
      };
    }

    case "disbursements":
    case "cash-receipts": {
      const out = p.type === "disbursements";
      const r = cashRegister(await d.ledger(), d.accounts, p, out ? "out" : "in");
      return {
        ...base(p.type, c, range(p), suffix),
        sections: [{
          columns: [
            { key: "date", label: "Date", width: 0.9 }, { key: "reference", label: "Ref", width: 0.9 }, { key: "party", label: out ? "Payee" : "Received from", width: 1.8 },
            { key: "category", label: out ? "Category" : "Source", width: 2 }, { key: "cash", label: out ? "Paid from" : "Deposited to", width: 1.2 }, moneyCol("amount", "Amount"),
          ],
          rows: r.lines.map((l) => ({
            date: formatDate(l.date), reference: l.reference, party: l.party,
            category: out ? l.counter_accounts : `${l.counter_accounts} (${l.source})`, cash: l.cash_account_name, amount: l.amount,
          })),
          totals: [{ party: `Total (${r.lines.length})`, amount: r.total }],
        }],
      };
    }

    case "business-tax": {
      const t = businessTax(await d.ledger(), d.accounts, p, c.tax_type);
      const fields: FormField[] = t.vat
        ? [
            { item: "A", label: "Vatable Sales/Receipts (net of VAT)", value: t.grossSales },
            { item: "B", label: `Output VAT per ledger (${VAT_RATE * 100}%)`, value: t.vat.outputVat },
            { item: "C", label: "Less: Input VAT per ledger", value: t.vat.inputVat },
            { item: "D", label: "VAT Payable / (Excess Input VAT)", value: t.vat.vatPayable },
            { item: "—", label: "Check: 12% of recorded sales", value: t.vat.computedOutputVat },
            { item: "—", label: "Variance (exempt/zero-rated sales or entry errors)", value: t.vat.variance },
          ]
        : [
            { item: "A", label: "Gross Sales/Receipts", value: t.grossSales },
            { item: "B", label: "Tax Rate", value: `${PERCENTAGE_TAX_RATE * 100}%` },
            { item: "C", label: "Percentage Tax Due (2551Q)", value: t.percentageTax!.due },
          ];
      return {
        ...base("business-tax", c, range(p), suffix),
        title: t.vat ? "VAT Computation (2550Q worksheet)" : "Percentage Tax Computation (2551Q worksheet)",
        sections: [formSection(fields)],
        warnings: t.vat && t.vat.variance !== 0 ? ["Output VAT differs from 12% of recorded sales; review exempt/zero-rated sales before filing."] : [],
      };
    }

    case "bir-1601c": {
      const period = p.period ?? p.to.slice(0, 7);
      const f = form1601C(await d.payrollItems(period), period);
      return {
        ...base("bir-1601c", c, `For the month ${period.slice(5)}/${period.slice(0, 4)}`, period),
        title: "BIR Form 1601-C — Monthly Remittance Return of Income Taxes Withheld on Compensation",
        sections: [formSection(f.fields, "Part II — Computation of Tax")],
        footnote: `${f.employees} employee(s). Generated for review; file via eBIRForms/eFPS.`,
      };
    }

    case "bir-2316":
    case "bir-1604c": {
      const year = p.year ?? Number(p.to.slice(0, 4));
      const [items, employees, tables] = await Promise.all([d.payrollItems(`${year}-`), d.employees(), d.tables(`${year}-12-31`)]);
      if (p.type === "bir-2316") {
        const list = employees.filter((e) => !p.employee_id || e.id === p.employee_id).map((e) => form2316(items, e, year, tables.wtax_annual)).filter((f) => f.gross > 0);
        return {
          ...base("bir-2316", c, `Calendar year ${year}`, String(year)),
          title: "BIR Form 2316 — Certificate of Compensation Payment / Tax Withheld",
          sections: list.map((f) => ({
            ...formSection(f.fields, `${f.employee.name} — TIN ${f.employee.TIN || "(missing)"}`),
            note: f.adjustment === 0 ? "Tax due equals tax withheld." : f.adjustment > 0 ? `Under-withheld by ${formatPeso(f.adjustment)} — collect on year-end adjustment.` : `Over-withheld by ${formatPeso(-f.adjustment)} — refund on year-end adjustment.`,
          })),
          warnings: list.filter((f) => !f.employee.TIN).map((f) => `${f.employee.name} has no TIN on file.`),
        };
      }
      const f = form1604C(items, employees, year, tables.wtax_annual);
      return {
        ...base("bir-1604c", c, `Calendar year ${year}`, String(year)),
        title: "BIR Form 1604-C — Annual Information Return of Income Taxes Withheld on Compensation",
        sections: [
          {
            heading: "Part II — Summary of Remittances per BIR Form 1601-C",
            columns: [{ key: "month", label: "Month", width: 1 }, moneyCol("withheld", "Taxes Withheld"), moneyCol("adj", "Adjustment"), moneyCol("total", "Total Remitted")],
            rows: f.remittances.map((r) => ({ month: r.month, withheld: r.taxesWithheld, adj: r.adjustment, total: r.total })),
            totals: [{ month: "Total", withheld: f.totalWithheld, adj: 0, total: f.totalWithheld }],
          },
          {
            heading: "Alphalist — Schedule 1 (employees as of December 31)",
            columns: [
              { key: "name", label: "Employee", width: 2 }, { key: "tin", label: "TIN", width: 1.3 }, moneyCol("gross", "Gross Comp"), moneyCol("nontax", "Non-taxable"),
              moneyCol("taxable", "Taxable"), moneyCol("due", "Tax Due"), moneyCol("withheld", "Withheld"), moneyCol("adj", "Adjustment"),
            ],
            rows: f.alphalist.map((a) => ({ name: a.employee.name, tin: a.employee.TIN, gross: a.gross, nontax: a.nonTaxable, taxable: a.taxable, due: a.taxDue, withheld: a.withheld, adj: a.adjustment })),
            totals: [{ name: "Total", gross: f.totals.gross, nontax: f.totals.nonTaxable, taxable: f.totals.taxable, due: f.totals.taxDue, withheld: f.totals.withheld, adj: f.totals.taxDue - f.totals.withheld }],
          },
        ],
        footnote: "Alphalist values are also available as an Excel export for the BIR Alphalist Data Entry module.",
      };
    }

    case "bir-1701q": {
      const year = p.year ?? Number(p.to.slice(0, 4));
      const quarter = (p.quarter ?? Math.min(3, Math.ceil(Number(p.to.slice(5, 7)) / 3))) as 1 | 2 | 3;
      const [rows, tables] = await Promise.all([d.ledger(), d.tables(`${year}-12-31`)]);
      const f = form1701Q({
        rows, accounts: d.accounts, year, quarter, option: p.option, taxType: c.tax_type, annual: tables.wtax_annual,
        priorQuarterPayments: toCentavos(p.prior_payments), creditableWithholding: toCentavos(p.cwt),
      });
      const bt = f.business;
      const businessFields: FormField[] = bt.vat
        ? [
            { item: "V1", label: "Vatable sales (quarter)", value: bt.grossSales },
            { item: "V2", label: "Output VAT", value: bt.vat.outputVat },
            { item: "V3", label: "Input VAT", value: bt.vat.inputVat },
            { item: "V4", label: "VAT payable (2550Q)", value: bt.vat.vatPayable },
          ]
        : [
            { item: "P1", label: "Gross sales/receipts (quarter)", value: bt.grossSales },
            { item: "P2", label: `Percentage tax at ${PERCENTAGE_TAX_RATE * 100}% (2551Q)`, value: p.option === "eight_percent" ? 0 : bt.percentageTax!.due },
          ];
      return {
        ...base("bir-1701q", c, `Q${quarter} ${year} (cumulative from Jan 1)`, `${year}-Q${quarter}`),
        title: "BIR Form 1701Q — Quarterly Income Tax Return (Individuals)",
        sections: [formSection(f.fields, "Computation of Income Tax"), formSection(businessFields, "Business Tax for the Quarter")],
        warnings: [...(c.taxpayer_type !== "individual" ? ["This client is set up as a corporation; 1701Q applies to individuals (corporations file 1702Q)."] : []), ...f.warnings],
      };
    }
  }
}

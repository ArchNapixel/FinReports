export interface SalesCsvRow {
  date: string;
  invoiceNo: string;
  customer: string;
  item: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  paymentMethod: string;
  category: string;
  source: string;
}

const COLUMN_KEYS: Record<string, keyof SalesCsvRow> = {
  date: "date",
  "invoice no": "invoiceNo",
  "customer name": "customer",
  "item/description": "item",
  quantity: "quantity",
  "unit price": "unitPrice",
  amount: "amount",
  "payment method": "paymentMethod",
  category: "category",
};

/** Parses the "Date,Invoice No,Customer Name,..." sales CSV format used for import. */
export function parseSalesCsv(text: string, source: string): SalesCsvRow[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0]?.split(",").map((c) => c.trim().toLowerCase()) ?? [];
  const fields = header.map((h) => COLUMN_KEYS[h]);

  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(",");
    const row: Partial<SalesCsvRow> = { source };
    fields.forEach((field, i) => {
      if (!field) return;
      const raw = cells[i]?.trim() ?? "";
      (row as Record<string, unknown>)[field] = field === "quantity" || field === "unitPrice" || field === "amount" ? Number(raw) || 0 : raw;
    });
    return row as SalesCsvRow;
  });
}

export interface GroupTotal {
  label: string;
  amount: number;
  count: number;
}

function groupBy(rows: SalesCsvRow[], key: (r: SalesCsvRow) => string): GroupTotal[] {
  const totals = new Map<string, GroupTotal>();
  for (const r of rows) {
    const label = key(r) || "(unknown)";
    const cur = totals.get(label) ?? { label, amount: 0, count: 0 };
    cur.amount += r.amount;
    cur.count += 1;
    totals.set(label, cur);
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount);
}

export interface SalesSummary {
  rows: SalesCsvRow[];
  totalAmount: number;
  byCategory: GroupTotal[];
  byCustomer: GroupTotal[];
  byMonth: GroupTotal[];
  byFile: GroupTotal[];
}

/** Merges rows from any number of CSVs into one combined summary. */
export function combineSales(rows: SalesCsvRow[]): SalesSummary {
  return {
    rows,
    totalAmount: rows.reduce((sum, r) => sum + r.amount, 0),
    byCategory: groupBy(rows, (r) => r.category),
    byCustomer: groupBy(rows, (r) => r.customer),
    byMonth: groupBy(rows, (r) => r.date.slice(0, 7)),
    byFile: groupBy(rows, (r) => r.source),
  };
}

/** "sales_data_bellas_salon.csv" -> "Bellas Salon" */
function prettifyCompanyName(filename: string): string {
  return filename
    .replace(/\.csv$/i, "")
    .replace(/^sales_data_/i, "")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export interface CategoryBreakdown {
  category: string;
  units: number;
  amount: number;
  pctOfCompany: number;
}

export interface PaymentBreakdown {
  method: string;
  amount: number;
  pctOfCompany: number;
}

export interface CompanySummary {
  company: string;
  source: string;
  categories: CategoryBreakdown[];
  payments: PaymentBreakdown[];
  transactions: number;
  unitsSold: number;
  salesAmount: number;
  avgTransactionValue: number;
}

export interface PortfolioRow {
  company: string;
  totalSales: number;
  pctOfPortfolio: number;
}

export interface SalesSummaryReport {
  companies: CompanySummary[];
  portfolio: PortfolioRow[];
  grandTotal: number;
}

/** The "Summary of Sales" format: per-company category/payment breakdowns, then a consolidated portfolio table. */
export function buildSalesSummary(rowsByFile: Record<string, SalesCsvRow[]>): SalesSummaryReport {
  const companies = Object.entries(rowsByFile).map(([source, rows]) => {
    const salesAmount = rows.reduce((s, r) => s + r.amount, 0);
    const categories = groupBy(rows, (r) => r.category).map((g) => ({
      category: g.label,
      units: rows.filter((r) => r.category === g.label).reduce((s, r) => s + r.quantity, 0),
      amount: g.amount,
      pctOfCompany: salesAmount > 0 ? g.amount / salesAmount : 0,
    }));
    const payments = groupBy(rows, (r) => r.paymentMethod).map((g) => ({
      method: g.label,
      amount: g.amount,
      pctOfCompany: salesAmount > 0 ? g.amount / salesAmount : 0,
    }));
    const unitsSold = rows.reduce((s, r) => s + r.quantity, 0);
    return {
      company: prettifyCompanyName(source),
      source,
      categories,
      payments,
      transactions: rows.length,
      unitsSold,
      salesAmount,
      avgTransactionValue: rows.length > 0 ? salesAmount / rows.length : 0,
    };
  });

  const grandTotal = companies.reduce((s, c) => s + c.salesAmount, 0);
  const portfolio = companies
    .map((c) => ({ company: c.company, totalSales: c.salesAmount, pctOfPortfolio: grandTotal > 0 ? c.salesAmount / grandTotal : 0 }))
    .sort((a, b) => b.totalSales - a.totalSales);

  return { companies, portfolio, grandTotal };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

const asPct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Serializes a SalesSummaryReport to CSV, mirroring the reference workbook's layout. */
export function salesSummaryToCsv(report: SalesSummaryReport): string {
  const lines: string[] = [];

  for (const c of report.companies) {
    lines.push(csvRow([c.company]));
    lines.push(csvRow(["Category", "Units Sold", "Sales Amount", "% of Company Sales"]));
    for (const cat of c.categories) lines.push(csvRow([cat.category, cat.units, cat.amount, asPct(cat.pctOfCompany)]));
    lines.push(csvRow(["Total", c.unitsSold, c.salesAmount, "100.0%"]));
    lines.push("");
    lines.push(csvRow(["Payment Method", "Sales Amount", "% of Company Sales"]));
    for (const p of c.payments) lines.push(csvRow([p.method, p.amount, asPct(p.pctOfCompany)]));
    lines.push("");
    lines.push(csvRow(["Total Transactions", c.transactions]));
    lines.push(csvRow(["Total Units Sold", c.unitsSold]));
    lines.push(csvRow(["Total Sales Amount", c.salesAmount]));
    lines.push(csvRow(["Average Transaction Value", c.avgTransactionValue.toFixed(2)]));
    lines.push("");
  }

  lines.push(csvRow(["Consolidated Summary - All Client Companies"]));
  lines.push(csvRow(["Client Company", "Total Sales Amount", "% of Portfolio Sales"]));
  for (const p of report.portfolio) lines.push(csvRow([p.company, p.totalSales, asPct(p.pctOfPortfolio)]));
  lines.push(csvRow(["Grand Total", report.grandTotal, "100.0%"]));

  return lines.join("\n");
}

/** Serializes the merged line items behind a plain Sales Report to CSV. */
export function salesRowsToCsv(rows: SalesCsvRow[]): string {
  const lines = [csvRow(["Date", "Invoice No", "Customer", "Item", "Quantity", "Unit Price", "Amount", "Payment Method", "Category", "Source"])];
  for (const r of rows) lines.push(csvRow([r.date, r.invoiceNo, r.customer, r.item, r.quantity, r.unitPrice, r.amount, r.paymentMethod, r.category, r.source]));
  return lines.join("\n");
}

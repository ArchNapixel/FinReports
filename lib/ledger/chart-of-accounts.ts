export type AccountType = "asset" | "liability" | "equity" | "revenue" | "cost_of_sales" | "expense";
export type CashFlowClass = "operating" | "investing" | "financing";

export interface AccountDef {
  code: string;
  name: string;
  type: AccountType;
  subtype?: string;
  is_cash?: boolean;
  cash_flow_class?: CashFlowClass;
  /** Hints for Nena's offline fallback categorizer. */
  keywords?: string[];
}

/** Well-known account codes the posting logic relies on. */
export const SYSTEM_ACCOUNTS = {
  cashOnHand: "1000",
  cashInBank: "1010",
  accountsReceivable: "1100",
  inputVat: "1300",
  creditableWithholding: "1310",
  accountsPayable: "2000",
  salariesPayable: "2010",
  outputVat: "2100",
  withholdingTaxPayable: "2110",
  percentageTaxPayable: "2120",
  sssPayable: "2130",
  philhealthPayable: "2140",
  pagibigPayable: "2150",
  ownersCapital: "3000",
  sales: "4000",
  serviceRevenue: "4010",
  salaries: "6000",
  employerContributions: "6010",
  miscExpense: "6900",
} as const;

/**
 * Philippine SME chart of accounts, following the classification used in
 * BIR-registered books (assets, liabilities, equity, revenue, cost of
 * sales, operating expenses).
 */
export const PH_STANDARD_COA: AccountDef[] = [
  { code: "1000", name: "Cash on Hand", type: "asset", subtype: "current", is_cash: true, keywords: ["cash"] },
  { code: "1010", name: "Cash in Bank", type: "asset", subtype: "current", is_cash: true, keywords: ["bank", "transfer"] },
  { code: "1020", name: "E-Wallets (GCash/Maya)", type: "asset", subtype: "current", is_cash: true, keywords: ["gcash", "maya", "paymaya"] },
  { code: "1100", name: "Accounts Receivable", type: "asset", subtype: "current" },
  { code: "1200", name: "Inventory", type: "asset", subtype: "current", keywords: ["inventory", "merchandise", "stock"] },
  { code: "1250", name: "Prepaid Expenses", type: "asset", subtype: "current", keywords: ["prepaid", "advance"] },
  { code: "1300", name: "Input VAT", type: "asset", subtype: "current" },
  { code: "1310", name: "Creditable Withholding Tax", type: "asset", subtype: "current", keywords: ["2307"] },
  { code: "1500", name: "Property and Equipment", type: "asset", subtype: "noncurrent", cash_flow_class: "investing", keywords: ["laptop", "computer", "equipment", "furniture", "vehicle"] },
  { code: "1590", name: "Accumulated Depreciation", type: "asset", subtype: "contra", cash_flow_class: "investing" },
  { code: "2000", name: "Accounts Payable", type: "liability", subtype: "current" },
  { code: "2010", name: "Salaries Payable", type: "liability", subtype: "current" },
  { code: "2100", name: "Output VAT", type: "liability", subtype: "current" },
  { code: "2110", name: "Withholding Tax Payable - Compensation", type: "liability", subtype: "current" },
  { code: "2115", name: "Withholding Tax Payable - Expanded", type: "liability", subtype: "current" },
  { code: "2120", name: "Percentage Tax Payable", type: "liability", subtype: "current" },
  { code: "2130", name: "SSS Contributions Payable", type: "liability", subtype: "current" },
  { code: "2140", name: "PhilHealth Contributions Payable", type: "liability", subtype: "current" },
  { code: "2150", name: "Pag-IBIG Contributions Payable", type: "liability", subtype: "current" },
  { code: "2500", name: "Loans Payable", type: "liability", subtype: "noncurrent", cash_flow_class: "financing", keywords: ["loan"] },
  { code: "3000", name: "Owner's Capital", type: "equity", cash_flow_class: "financing", keywords: ["capital", "investment"] },
  { code: "3100", name: "Owner's Drawings", type: "equity", cash_flow_class: "financing", keywords: ["drawing", "withdrawal"] },
  { code: "3200", name: "Retained Earnings", type: "equity" },
  { code: "4000", name: "Sales", type: "revenue", keywords: ["sale", "sales"] },
  { code: "4010", name: "Service Revenue", type: "revenue", keywords: ["service", "fee", "professional"] },
  { code: "4100", name: "Sales Returns and Discounts", type: "revenue", subtype: "contra" },
  { code: "4900", name: "Other Income", type: "revenue", keywords: ["interest income", "other income"] },
  { code: "5000", name: "Cost of Sales", type: "cost_of_sales", keywords: ["purchases", "cost of goods"] },
  { code: "5010", name: "Freight In", type: "cost_of_sales", keywords: ["freight", "shipping", "lbc", "jrs"] },
  { code: "6000", name: "Salaries and Wages", type: "expense", keywords: ["salary", "wages", "payroll"] },
  { code: "6010", name: "SSS, PhilHealth and Pag-IBIG Contributions", type: "expense" },
  { code: "6100", name: "Rent Expense", type: "expense", keywords: ["rent", "lease"] },
  { code: "6110", name: "Utilities Expense", type: "expense", keywords: ["meralco", "maynilad", "manila water", "electric", "water", "veco", "davao light"] },
  { code: "6120", name: "Communication Expense", type: "expense", keywords: ["pldt", "globe", "smart", "converge", "sky", "internet", "load", "dito"] },
  { code: "6130", name: "Transportation and Travel", type: "expense", keywords: ["grab", "angkas", "joyride", "taxi", "toll", "easytrip", "autosweep", "airline", "cebu pacific", "pal"] },
  { code: "6140", name: "Fuel and Oil", type: "expense", keywords: ["petron", "shell", "caltex", "seaoil", "phoenix", "fuel", "gasoline", "diesel"] },
  { code: "6150", name: "Office Supplies", type: "expense", keywords: ["national book store", "nbs", "office warehouse", "supplies", "paper", "ink"] },
  { code: "6160", name: "Representation and Entertainment", type: "expense", keywords: ["restaurant", "jollibee", "mcdonald", "starbucks", "meal", "food", "cafe"] },
  { code: "6170", name: "Repairs and Maintenance", type: "expense", keywords: ["repair", "maintenance", "ace hardware", "wilcon", "handyman"] },
  { code: "6180", name: "Professional Fees", type: "expense", keywords: ["legal", "audit", "consultant", "notary"] },
  { code: "6190", name: "Taxes and Licenses", type: "expense", keywords: ["bir", "permit", "license", "mayor", "cedula", "registration"] },
  { code: "6200", name: "Advertising and Promotions", type: "expense", keywords: ["facebook", "meta", "google ads", "advertising", "tiktok"] },
  { code: "6210", name: "Insurance Expense", type: "expense", keywords: ["insurance"] },
  { code: "6220", name: "Depreciation Expense", type: "expense" },
  { code: "6230", name: "Bank Charges", type: "expense", keywords: ["bank charge", "service charge", "transfer fee"] },
  { code: "6240", name: "Software and Subscriptions", type: "expense", keywords: ["software", "subscription", "microsoft", "adobe", "canva", "zoom"] },
  { code: "6900", name: "Miscellaneous Expense", type: "expense" },
];

export const COA_TEMPLATES: Record<string, AccountDef[]> = {
  ph_standard: PH_STANDARD_COA,
};

export function normalBalance(type: AccountType): "debit" | "credit" {
  return type === "asset" || type === "expense" || type === "cost_of_sales" ? "debit" : "credit";
}

import { applyRate, type Centavos } from "@/lib/money";
import { SYSTEM_ACCOUNTS } from "@/lib/ledger/chart-of-accounts";
import type { AccountRow, LedgerRow, Period } from "@/lib/reports/types";

export const VAT_RATE = 0.12;
export const PERCENTAGE_TAX_RATE = 0.03;
/** VAT registration threshold (NIRC Sec. 109(BB) as amended by TRAIN). */
export const VAT_THRESHOLD = 3_000_000_00;

/** Split a VAT-inclusive amount into net and 12% VAT. */
export function vatFromGross(gross: Centavos): { net: Centavos; vat: Centavos } {
  const net = Math.round(gross / (1 + VAT_RATE));
  return { net, vat: gross - net };
}

export interface BusinessTaxSummary {
  period: Period;
  taxType: "vat" | "non_vat";
  grossSales: Centavos; // net of VAT
  vat?: { outputVat: Centavos; inputVat: Centavos; vatPayable: Centavos; computedOutputVat: Centavos; variance: Centavos };
  percentageTax?: { base: Centavos; rate: number; due: Centavos };
}

/**
 * VAT (Form 2550Q) or percentage tax (Form 2551Q) for the period, from the
 * ledger. Output/input VAT come from the 2100/1300 accounts; `variance`
 * flags output VAT that is not 12% of recorded sales (exempt/zero-rated
 * sales or data-entry errors worth a look).
 */
export function businessTax(rows: LedgerRow[], accountList: AccountRow[], period: Period, taxType: "vat" | "non_vat"): BusinessTaxSummary {
  const accounts = new Map(accountList.map((a) => [a.code, a]));
  const pr = rows.filter((r) => r.entry_date >= period.from && r.entry_date <= period.to);
  const sum = (pred: (r: LedgerRow) => boolean, credit: boolean) =>
    pr.filter(pred).reduce((s, r) => s + (credit ? r.credit - r.debit : r.debit - r.credit), 0);
  // Operating revenue only — "Other Income" (49xx) is not gross sales/receipts.
  const grossSales = sum((r) => accounts.get(r.account_code)?.type === "revenue" && !r.account_code.startsWith("49"), true);

  if (taxType === "vat") {
    const outputVat = sum((r) => r.account_code === SYSTEM_ACCOUNTS.outputVat, true);
    const inputVat = sum((r) => r.account_code === SYSTEM_ACCOUNTS.inputVat, false);
    const computedOutputVat = applyRate(grossSales, VAT_RATE);
    return {
      period, taxType, grossSales,
      vat: { outputVat, inputVat, vatPayable: outputVat - inputVat, computedOutputVat, variance: outputVat - computedOutputVat },
    };
  }
  return { period, taxType, grossSales, percentageTax: { base: grossSales, rate: PERCENTAGE_TAX_RATE, due: applyRate(grossSales, PERCENTAGE_TAX_RATE) } };
}

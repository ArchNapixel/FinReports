import type { Centavos } from "@/lib/money";
import type { AccountType, CashFlowClass } from "@/lib/ledger/chart-of-accounts";
import type { TxnSource } from "@/lib/ledger/types";

export interface AccountRow {
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  is_cash: boolean;
  cash_flow_class: CashFlowClass;
}

/** One ledger line joined with its transaction header. */
export interface LedgerRow {
  transaction_id: string;
  seq: number;
  entry_date: string;
  account_code: string;
  debit: Centavos;
  credit: Centavos;
  memo: string;
  vendor: string;
  description: string;
  reference: string | null;
  source: TxnSource;
}

export interface Period {
  from: string;
  to: string;
}

export interface CompanyHeader {
  id: string;
  name: string;
  TIN: string;
  registered_address: string;
  rdo_code: string;
  tax_type: "vat" | "non_vat";
  taxpayer_type: "individual" | "corporation";
}

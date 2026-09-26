import { SYSTEM_ACCOUNTS as A } from "@/lib/ledger/chart-of-accounts";
import { buildCompoundJournal } from "@/lib/ledger/journal";
import type { JournalDraft } from "@/lib/ledger/types";
import type { PayrollTotals } from "./compute";

/**
 * Payroll accrual when a run is finalized:
 *   Dr Salaries (gross), Dr Employer contributions (ER shares + EC)
 *   Cr SSS / PhilHealth / Pag-IBIG payable (EE + ER), Cr WTax payable,
 *   Cr Salaries payable (net pay)
 */
export function buildPayrollJournal(period: string, date: string, t: PayrollTotals, journalId: string): JournalDraft {
  const memo = `Payroll ${period}`;
  const employer = t.sss_er + t.sss_ec + t.philhealth_er + t.pagibig_er;
  return buildCompoundJournal(
    {
      id: journalId,
      date,
      vendor: "Payroll",
      description: memo,
      category: A.salaries,
      type: "debit",
      source: "payroll",
      reference: period,
      amount: t.gross + employer,
    },
    [
      { account_code: A.salaries, debit: t.gross, credit: 0, memo },
      { account_code: A.employerContributions, debit: employer, credit: 0, memo },
      { account_code: A.sssPayable, debit: 0, credit: t.sss_ee + t.sss_er + t.sss_ec, memo },
      { account_code: A.philhealthPayable, debit: 0, credit: t.philhealth_ee + t.philhealth_er, memo },
      { account_code: A.pagibigPayable, debit: 0, credit: t.pagibig_ee + t.pagibig_er, memo },
      { account_code: A.withholdingTaxPayable, debit: 0, credit: t.withholding_tax, memo },
      { account_code: A.salariesPayable, debit: 0, credit: t.net_pay, memo },
    ],
  );
}

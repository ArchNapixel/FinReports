import type { Centavos } from "@/lib/money";
import { formatPeso } from "@/lib/money";
import { SYSTEM_ACCOUNTS } from "@/lib/ledger/chart-of-accounts";
import { buildCompoundJournal } from "@/lib/ledger/journal";
import type { JournalDraft } from "@/lib/ledger/types";

export type DocStatus = "unpaid" | "partial" | "paid";
export type DocKind = "invoice" | "bill";

export class PaymentError extends Error {}

export function statusFor(amount: Centavos, amountPaid: Centavos): DocStatus {
  if (amountPaid <= 0) return "unpaid";
  if (amountPaid >= amount) return "paid";
  return "partial";
}

/** Validate a payment and return the document's new paid amount and status. */
export function applyPayment(doc: { amount: Centavos; amount_paid: Centavos }, payment: Centavos) {
  if (!Number.isInteger(payment) || payment <= 0) throw new PaymentError("Payment must be a positive amount");
  const balance = doc.amount - doc.amount_paid;
  if (balance <= 0) throw new PaymentError("Document is already fully paid");
  if (payment > balance) throw new PaymentError(`Payment ${formatPeso(payment)} exceeds the open balance of ${formatPeso(balance)}`);
  const amount_paid = doc.amount_paid + payment;
  return { amount_paid, status: statusFor(doc.amount, amount_paid), balance: doc.amount - amount_paid };
}

/** Recognition entry when an invoice or bill is recorded (accrual basis). */
export function buildRecognitionJournal(
  kind: DocKind,
  doc: { id: string; party: string; reference: string; issue_date: string; amount: Centavos; vat_amount: Centavos; account: string },
  journalId: string,
): JournalDraft {
  const net = doc.amount - doc.vat_amount;
  if (net <= 0) throw new PaymentError("VAT must be less than the document amount");
  const memo = `${kind === "invoice" ? "Invoice" : "Bill"} ${doc.reference}`.trim();
  const lines =
    kind === "invoice"
      ? [
          { account_code: SYSTEM_ACCOUNTS.accountsReceivable, debit: doc.amount, credit: 0, memo },
          { account_code: doc.account, debit: 0, credit: net, memo },
          { account_code: SYSTEM_ACCOUNTS.outputVat, debit: 0, credit: doc.vat_amount, memo: "Output VAT" },
        ]
      : [
          { account_code: doc.account, debit: net, credit: 0, memo },
          { account_code: SYSTEM_ACCOUNTS.inputVat, debit: doc.vat_amount, credit: 0, memo: "Input VAT" },
          { account_code: SYSTEM_ACCOUNTS.accountsPayable, debit: 0, credit: doc.amount, memo },
        ];
  return buildCompoundJournal(
    {
      id: journalId,
      date: doc.issue_date,
      vendor: doc.party,
      description: memo,
      category: doc.account,
      type: kind === "invoice" ? "credit" : "debit",
      source: kind,
      reference: doc.reference || null,
      amount: doc.amount,
    },
    lines,
  );
}

/** Settlement entry: invoice → Dr Cash / Cr AR;  bill → Dr AP / Cr Cash. */
export function buildPaymentJournal(
  kind: DocKind,
  p: { party: string; reference: string; paid_on: string; amount: Centavos; cash_account: string },
  journalId: string,
): JournalDraft {
  const memo = `Payment ${kind === "invoice" ? "received" : "made"} ${p.reference}`.trim();
  const lines =
    kind === "invoice"
      ? [
          { account_code: p.cash_account, debit: p.amount, credit: 0, memo },
          { account_code: SYSTEM_ACCOUNTS.accountsReceivable, debit: 0, credit: p.amount, memo },
        ]
      : [
          { account_code: SYSTEM_ACCOUNTS.accountsPayable, debit: p.amount, credit: 0, memo },
          { account_code: p.cash_account, debit: 0, credit: p.amount, memo },
        ];
  return buildCompoundJournal(
    {
      id: journalId,
      date: p.paid_on,
      vendor: p.party,
      description: memo,
      category: kind === "invoice" ? SYSTEM_ACCOUNTS.accountsReceivable : SYSTEM_ACCOUNTS.accountsPayable,
      type: kind === "invoice" ? "credit" : "debit",
      source: "payment",
      reference: p.reference || null,
      amount: p.amount,
    },
    lines,
  );
}

import type { Centavos } from "@/lib/money";
import { daysBetween } from "@/lib/dates";

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
export const AGING_BUCKETS: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

export interface OpenItem {
  id: string;
  party: string;
  reference?: string;
  issue_date: string;
  due_date: string;
  amount: Centavos;
  amount_paid: Centavos;
}

export interface AgedItem extends OpenItem {
  balance: Centavos;
  days_overdue: number;
  bucket: AgingBucket;
}

/** Bucket by days past due as of `asOf`; not-yet-due items are "current". */
export function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

export interface AgingReport {
  asOf: string;
  items: AgedItem[];
  totals: Record<AgingBucket, Centavos>;
  byParty: { party: string; totals: Record<AgingBucket, Centavos>; total: Centavos }[];
  total: Centavos;
}

function emptyTotals(): Record<AgingBucket, Centavos> {
  return { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
}

export function ageItems(items: OpenItem[], asOf: string): AgingReport {
  const aged: AgedItem[] = items
    .filter((i) => i.issue_date <= asOf)
    .map((i) => {
      const days = daysBetween(i.due_date, asOf);
      return { ...i, balance: i.amount - i.amount_paid, days_overdue: Math.max(0, days), bucket: bucketFor(days) };
    })
    .filter((i) => i.balance > 0)
    .sort((a, b) => b.days_overdue - a.days_overdue || a.party.localeCompare(b.party));

  const totals = emptyTotals();
  const parties = new Map<string, Record<AgingBucket, Centavos>>();
  for (const i of aged) {
    totals[i.bucket] += i.balance;
    const p = parties.get(i.party) ?? emptyTotals();
    p[i.bucket] += i.balance;
    parties.set(i.party, p);
  }
  const byParty = [...parties.entries()]
    .map(([party, t]) => ({ party, totals: t, total: AGING_BUCKETS.reduce((s, b) => s + t[b], 0) }))
    .sort((a, b) => b.total - a.total);
  return { asOf, items: aged, totals, byParty, total: AGING_BUCKETS.reduce((s, b) => s + totals[b], 0) };
}

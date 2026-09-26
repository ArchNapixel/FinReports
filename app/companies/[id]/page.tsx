import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadAccounts, loadLedgerRows } from "@/lib/data/ledger-repo";
import { formatPeso } from "@/lib/money";

export default async function CompanyDashboard({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: company } = await supabase.from("client_companies").select("*").eq("id", params.id).maybeSingle();
  if (!company) notFound();

  const [accounts, ledger] = await Promise.all([
    loadAccounts(supabase, params.id),
    loadLedgerRows(supabase, params.id),
  ]);
  const recent = ledger.slice(-10).reverse();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-ink">{company.name}</h1>
      <p className="text-sm text-ink-muted">
        {company.tax_type.toUpperCase()} · {company.taxpayer_type} · {accounts.length} accounts
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-faint">Recent ledger entries</h2>
      {recent.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No transactions posted yet.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {recent.map((r) => (
              <tr key={`${r.transaction_id}-${r.seq}`} className="border-b border-slate-100">
                <td className="py-2 text-ink-muted">{r.entry_date}</td>
                <td className="py-2 text-ink">{r.vendor || r.description}</td>
                <td className="py-2 text-right text-ink">{formatPeso(r.debit || r.credit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

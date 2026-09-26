import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function CompaniesPage() {
  const supabase = createClient();
  const { data: companies, error } = await supabase
    .from("client_companies")
    .select("id,name,tax_type,taxpayer_type,created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Client companies</h1>
        <Link href="/companies/new" className="rounded bg-nena px-3 py-1.5 text-sm text-white">
          New company
        </Link>
      </div>

      {companies?.length ? (
        <ul className="mt-6 divide-y divide-slate-200">
          {companies.map((c) => (
            <li key={c.id}>
              <Link href={`/companies/${c.id}`} className="flex items-center justify-between py-3 hover:bg-slate-50">
                <span className="font-medium text-ink">{c.name}</span>
                <span className="text-sm text-ink-muted">
                  {c.tax_type.toUpperCase()} · {c.taxpayer_type}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-sm text-ink-muted">No client companies yet.</p>
      )}
    </main>
  );
}

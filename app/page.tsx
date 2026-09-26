import { createClient } from "@/lib/supabase/server";
import { getGenerationQuota } from "@/lib/nena/quota";
import { GenerateReportButton } from "@/components/GenerateReportButton";

export default async function Dashboard() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: accountant } = await supabase
    .from("accountants")
    .select("name")
    .eq("id", user!.id)
    .single();
  const { used, limit, remaining } = await getGenerationQuota(supabase, user!.id);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold text-ink">
        Welcome back{accountant?.name ? `, ${accountant.name}` : ""}
      </h1>

      <div className="mt-6 rounded border border-slate-200 p-4">
        <p className="text-sm text-ink-muted">Nena generates left today</p>
        <p className="mt-1 text-3xl font-semibold text-ink">
          {remaining} <span className="text-base font-normal text-ink-muted">/ {limit}</span>
        </p>
        <p className="mt-1 text-xs text-ink-muted">{used} used today</p>
      </div>

      <GenerateReportButton />
    </main>
  );
}

import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: accountant } = await supabase
    .from("accountants")
    .select("name, email, subscription_tier")
    .eq("id", user!.id)
    .single();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold text-ink">Profile</h1>
      <div className="mt-6 space-y-3 rounded border border-slate-200 p-4 text-sm">
        <div>
          <span className="text-ink-muted">Name</span>
          <p className="text-ink">{accountant?.name || "—"}</p>
        </div>
        <div>
          <span className="text-ink-muted">Email</span>
          <p className="text-ink">{accountant?.email}</p>
        </div>
        <div>
          <span className="text-ink-muted">Plan</span>
          <p className="capitalize text-ink">{accountant?.subscription_tier}</p>
        </div>
      </div>
    </main>
  );
}

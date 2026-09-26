"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function NavBar() {
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <nav className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
        <Link href="/" className="font-semibold text-ink">
          FinReports
        </Link>
        <button onClick={logout} className="rounded bg-slate-100 px-3 py-1.5 text-sm text-ink hover:bg-slate-200">
          Log out
        </button>
      </nav>

      <Link
        href="/profile"
        className="fixed bottom-4 left-4 rounded bg-slate-100 px-3 py-1.5 text-sm text-ink hover:bg-slate-200"
      >
        Profile
      </Link>
    </>
  );
}

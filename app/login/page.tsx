import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold text-ink">Sign in to FinReports</h1>
      <AuthForm mode="login" />
      <p className="text-sm text-ink-muted">
        No account? <Link href="/signup" className="text-nena underline">Sign up</Link>
      </p>
    </main>
  );
}

import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";

export default function SignupPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold text-ink">Create your FinReports account</h1>
      <AuthForm mode="signup" />
      <p className="text-sm text-ink-muted">
        Already have an account? <Link href="/login" className="text-nena underline">Sign in</Link>
      </p>
    </main>
  );
}

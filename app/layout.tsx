import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "FinReports",
  description: "Bookkeeping, payroll and ready-to-file BIR reports for independent accountants.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="bg-white text-ink antialiased">
        {user && <NavBar />}
        {children}
      </body>
    </html>
  );
}

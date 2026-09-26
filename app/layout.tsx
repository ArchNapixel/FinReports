import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FinReports",
  description: "Bookkeeping, payroll and ready-to-file BIR reports for independent accountants.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-ink antialiased">{children}</body>
    </html>
  );
}

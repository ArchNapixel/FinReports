"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function NewCompanyPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", TIN: "", tax_type: "vat", taxpayer_type: "corporation" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json();
    setLoading(false);
    if (!res.ok) return setError(body.error ?? "Something went wrong");
    router.push(`/companies/${body.id}`);
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold text-ink">New client company</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
        <input
          required
          placeholder="Company name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded border border-slate-300 px-3 py-2"
        />
        <input
          placeholder="TIN"
          value={form.TIN}
          onChange={(e) => setForm({ ...form, TIN: e.target.value })}
          className="rounded border border-slate-300 px-3 py-2"
        />
        <label className="text-sm text-ink-muted">
          Tax type
          <select
            value={form.tax_type}
            onChange={(e) => setForm({ ...form, tax_type: e.target.value })}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          >
            <option value="vat">VAT</option>
            <option value="non_vat">Non-VAT</option>
          </select>
        </label>
        <label className="text-sm text-ink-muted">
          Taxpayer type
          <select
            value={form.taxpayer_type}
            onChange={(e) => setForm({ ...form, taxpayer_type: e.target.value })}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          >
            <option value="corporation">Corporation</option>
            <option value="individual">Individual</option>
          </select>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={loading} className="rounded bg-nena px-3 py-2 text-white disabled:opacity-50">
          {loading ? "Creating…" : "Create company"}
        </button>
      </form>
    </main>
  );
}

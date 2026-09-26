import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createClient, type Supabase } from "@/lib/supabase/server";
import { LedgerError } from "@/lib/ledger/journal";
import { PaymentError } from "@/lib/arap/payments";

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export interface Ctx {
  supabase: Supabase;
  userId: string;
}

export async function requireUser(): Promise<Ctx> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new HttpError(401, "Not signed in");
  return { supabase, userId: user.id };
}

/** Verify the signed-in accountant owns the company (RLS enforces it too). */
export async function requireCompany(ctx: Ctx, companyId: unknown) {
  if (typeof companyId !== "string" || !/^[0-9a-f-]{36}$/i.test(companyId)) throw new HttpError(400, "client_company_id is required");
  const { data, error } = await ctx.supabase.from("client_companies").select("*").eq("id", companyId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Client company not found");
  return data as CompanyRecord;
}

export interface CompanyRecord {
  id: string;
  accountant_id: string;
  name: string;
  TIN: string;
  industry: string;
  chart_of_accounts_template: string;
  registered_address: string;
  rdo_code: string;
  tax_type: "vat" | "non_vat";
  taxpayer_type: "individual" | "corporation";
  created_at: string;
}

/** Wrap a route handler with uniform JSON error responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input", issues: e.issues }, { status: 400 });
      if (e instanceof LedgerError || e instanceof PaymentError) {
        return NextResponse.json({ error: e.message }, { status: 422 });
      }
      console.error(e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status: 500 });
    }
  };
}

import { toCentavos } from "@/lib/money";
import { resolveTables, type StatutoryRow } from "@/lib/payroll/tables";
import type { EmployeeRow, PayrollItemRow } from "@/lib/tax/bir-forms";
import type { Supabase } from "@/lib/supabase/server";
import { HttpError } from "./http";

export async function loadStatutoryTables(supabase: Supabase, onDate: string) {
  const { data, error } = await supabase.from("statutory_tables").select("kind,effective_from,effective_to,payload");
  if (error) throw new HttpError(500, error.message);
  try {
    return resolveTables(data as StatutoryRow[], onDate);
  } catch (e) {
    throw new HttpError(422, (e as Error).message);
  }
}

/** Finalized payroll items for a company, flattened for BIR computations. */
export async function loadPayrollItems(supabase: Supabase, companyId: string, periodPrefix?: string): Promise<PayrollItemRow[]> {
  let q = supabase.from("payroll_items")
    .select('employee_id,gross,"SSS_deduction","PhilHealth_deduction","PagIBIG_deduction",withholding_tax,payroll_runs!inner(period,status,client_company_id)')
    .eq("payroll_runs.client_company_id", companyId)
    .eq("payroll_runs.status", "finalized");
  if (periodPrefix) q = q.like("payroll_runs.period", `${periodPrefix}%`);
  const { data, error } = await q;
  if (error) throw new HttpError(500, error.message);
  return (data as unknown as Array<Record<string, unknown> & { payroll_runs: { period: string } }>).map((r) => ({
    employee_id: r.employee_id as string,
    period: r.payroll_runs.period,
    gross: toCentavos(r.gross as number),
    sss: toCentavos(r.SSS_deduction as number),
    philhealth: toCentavos(r.PhilHealth_deduction as number),
    pagibig: toCentavos(r.PagIBIG_deduction as number),
    withholding_tax: toCentavos(r.withholding_tax as number),
  }));
}

export async function loadEmployees(supabase: Supabase, companyId: string): Promise<(EmployeeRow & Record<string, unknown>)[]> {
  const { data, error } = await supabase.from("employees").select("*").eq("client_company_id", companyId).order("name");
  if (error) throw new HttpError(500, error.message);
  return data as (EmployeeRow & Record<string, unknown>)[];
}

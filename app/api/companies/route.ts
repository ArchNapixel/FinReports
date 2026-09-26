import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, requireUser } from "@/lib/data/http";
import { seedChartOfAccounts } from "@/lib/data/ledger-repo";

const CompanyInput = z.object({
  name: z.string().min(1),
  TIN: z.string().optional().default(""),
  industry: z.string().optional().default(""),
  registered_address: z.string().optional().default(""),
  rdo_code: z.string().optional().default(""),
  tax_type: z.enum(["vat", "non_vat"]).default("vat"),
  taxpayer_type: z.enum(["individual", "corporation"]).default("corporation"),
});

export const POST = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser();
  const input = CompanyInput.parse(await req.json());

  const { data, error } = await supabase
    .from("client_companies")
    .insert({ ...input, accountant_id: userId })
    .select("id")
    .single();
  if (error) throw error;

  await seedChartOfAccounts(supabase, data.id, "ph_standard");
  return NextResponse.json({ id: data.id });
});

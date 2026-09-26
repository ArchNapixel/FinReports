import type { Supabase } from "@/lib/supabase/server";

// ponytail: flat map instead of a config table, add a real plans table if pricing gets more dynamic.
const DAILY_LIMITS: Record<string, number> = { trial: 5, solo: 20, pro: 100 };

export async function getGenerationQuota(supabase: Supabase, userId: string) {
  const { data: accountant } = await supabase
    .from("accountants")
    .select("subscription_tier")
    .eq("id", userId)
    .single();
  const limit = DAILY_LIMITS[accountant?.subscription_tier ?? "trial"] ?? DAILY_LIMITS.trial;

  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await supabase
    .from("generation_usage")
    .select("count")
    .eq("accountant_id", userId)
    .eq("usage_date", today)
    .maybeSingle();

  const used = usage?.count ?? 0;
  return { used, limit, remaining: Math.max(limit - used, 0) };
}

/** Call once per actual Nena generation (categorize/chat/narrative/receipt) to decrement the daily quota. */
export async function consumeGeneration(supabase: Supabase): Promise<number> {
  const { data, error } = await supabase.rpc("increment_generation_usage");
  if (error) throw error;
  return data as number;
}

import { z } from "zod";

/**
 * Shapes of the versioned rows in `statutory_tables`. Values are data, not
 * code: a rate change is a new row with a later effective_from.
 */
export const SssTable = z.object({
  ee_rate: z.number(),
  er_rate: z.number(),
  msc_min: z.number(),
  msc_max: z.number(),
  msc_step: z.number(),
  ec_threshold: z.number(),
  ec_low: z.number(),
  ec_high: z.number(),
});
export const PhilHealthTable = z.object({
  rate: z.number(),
  floor: z.number(),
  ceiling: z.number(),
  ee_share: z.number(),
});
export const PagIbigTable = z.object({
  ee_rate: z.number(),
  ee_rate_low: z.number(),
  low_threshold: z.number(),
  er_rate: z.number(),
  max_fund_salary: z.number(),
});
const Bracket = z.object({ over: z.number(), base: z.number(), rate: z.number() });
export const WtaxTable = z.object({
  brackets: z.array(Bracket).min(1),
  nontaxable_13th_month_cap: z.number().optional(),
  eight_percent_exempt: z.number().optional(),
});

export type SssTable = z.infer<typeof SssTable>;
export type PhilHealthTable = z.infer<typeof PhilHealthTable>;
export type PagIbigTable = z.infer<typeof PagIbigTable>;
export type WtaxTable = z.infer<typeof WtaxTable>;

export type StatutoryKind = "sss" | "philhealth" | "pagibig" | "wtax_monthly" | "wtax_annual";

export interface StatutoryRow {
  kind: StatutoryKind;
  effective_from: string;
  effective_to: string | null;
  payload: unknown;
}

export interface StatutoryTables {
  sss: SssTable;
  philhealth: PhilHealthTable;
  pagibig: PagIbigTable;
  wtax_monthly: WtaxTable;
  wtax_annual: WtaxTable;
}

const parsers = {
  sss: SssTable,
  philhealth: PhilHealthTable,
  pagibig: PagIbigTable,
  wtax_monthly: WtaxTable,
  wtax_annual: WtaxTable,
} as const;

/** Pick, for each kind, the row in force on `onDate`. */
export function resolveTables(rows: StatutoryRow[], onDate: string): StatutoryTables {
  const out: Partial<Record<StatutoryKind, unknown>> = {};
  for (const kind of Object.keys(parsers) as StatutoryKind[]) {
    const row = rows
      .filter((r) => r.kind === kind && r.effective_from <= onDate && (!r.effective_to || r.effective_to >= onDate))
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    if (!row) throw new Error(`No ${kind} table is effective on ${onDate}. Add one to statutory_tables.`);
    out[kind] = parsers[kind].parse(row.payload);
  }
  return out as StatutoryTables;
}

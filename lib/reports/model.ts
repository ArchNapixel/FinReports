/**
 * Every report renders from this one shape, so PDF and Excel exports stay
 * identical and new reports only need a builder.
 */
export type Cell = string | number | null;

export interface Column {
  key: string;
  label: string;
  /** Values are centavos; render as currency. */
  money?: boolean;
  align?: "left" | "right" | "center";
  /** Relative width for PDF layout (default 1). */
  width?: number;
}

export interface Section {
  heading?: string;
  columns: Column[];
  rows: Record<string, Cell>[];
  /** Rendered bold beneath the rows. */
  totals?: Record<string, Cell>[];
  /** Render as a BIR form item list (item | label | value). */
  variant?: "table" | "form";
  note?: string;
}

export interface ReportModel {
  type: string;
  title: string;
  company: { name: string; TIN: string; address: string; rdo: string };
  periodLabel: string;
  sections: Section[];
  /** Nena's MD&A, rendered under "Narrative by Nena". */
  narrative?: string | null;
  warnings?: string[];
  footnote?: string;
  generatedAt: string;
  /** Suggested download filename without extension. */
  filename: string;
}

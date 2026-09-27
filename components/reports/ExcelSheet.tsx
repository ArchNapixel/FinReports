import type { ReactNode } from "react";

export interface ExcelColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

const COL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Renders tabular data as a corporate-style Excel sheet: column letters, row
 * numbers, gridlines, shaded header — instead of a plain HTML table.
 */
export function ExcelSheet({
  columns,
  rows,
  totalRow,
  sheetName = "Sheet1",
}: {
  columns: ExcelColumn[];
  rows: Record<string, ReactNode>[];
  totalRow?: Record<string, ReactNode>;
  sheetName?: string;
}) {
  return (
    <div className="overflow-hidden rounded border border-slate-300 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]" style={{ fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif" }}>
          <thead>
            <tr>
              <th className="w-9 border border-slate-300 bg-slate-100" />
              {columns.map((_, i) => (
                <th key={i} className="border border-slate-300 bg-slate-100 px-2 py-0.5 text-center text-[11px] font-normal text-slate-500">
                  {COL_LETTERS[i] ?? i + 1}
                </th>
              ))}
            </tr>
            <tr>
              <th className="border border-slate-300 bg-slate-100" />
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 ${
                    c.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className={ri % 2 ? "bg-slate-50/60" : "bg-white"}>
                <td className="border border-slate-300 bg-slate-100 px-1 text-center text-[11px] text-slate-400">{ri + 1}</td>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`border border-slate-200 px-2 py-1 tabular-nums text-ink ${c.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
            {totalRow && (
              <tr className="bg-slate-100 font-semibold">
                <td className="border border-slate-300 bg-slate-100" />
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`border-t-2 border-slate-400 px-2 py-1 tabular-nums text-ink ${c.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {totalRow[c.key]}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-300 bg-slate-50 px-3 py-1 text-[11px] text-slate-400">{sheetName}</div>
    </div>
  );
}

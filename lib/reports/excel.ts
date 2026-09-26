import ExcelJS from "exceljs";
import type { ReportModel } from "./model";

const PESO_FMT = '#,##0.00;(#,##0.00);"-"';

/** One worksheet per report; sections stacked with headings, money as numbers. */
export async function renderReportXlsx(model: ReportModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FinReports";
  wb.created = new Date();
  const ws = wb.addWorksheet(model.title.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"));
  const maxCols = Math.max(...model.sections.map((s) => s.columns.length), 2);

  ws.addRow([model.company.name]).font = { bold: true, size: 13 };
  if (model.company.TIN) ws.addRow([`TIN ${model.company.TIN}`]);
  ws.addRow([model.title]).font = { bold: true };
  ws.addRow([model.periodLabel]);
  for (const w of model.warnings ?? []) ws.addRow([`⚠ ${w}`]).font = { color: { argb: "FFB45309" } };
  ws.addRow([]);

  for (const sec of model.sections) {
    if (sec.heading) ws.addRow([sec.heading]).font = { bold: true, size: 11 };
    if (sec.note) ws.addRow([sec.note]).font = { italic: true, color: { argb: "FF475569" } };
    if (sec.rows.length) {
      const h = ws.addRow(sec.columns.map((c) => c.label));
      h.font = { bold: true };
      h.border = { bottom: { style: "thin" } };
    }
    const write = (r: Record<string, unknown>, bold = false) => {
      const row = ws.addRow(
        sec.columns.map((c) => {
          const v = r[c.key];
          const money = c.money || (sec.variant === "form" && c.key === "value");
          return money && typeof v === "number" ? v / 100 : (v ?? null);
        }),
      );
      sec.columns.forEach((c, i) => {
        if (c.money || (sec.variant === "form" && c.key === "value")) row.getCell(i + 1).numFmt = PESO_FMT;
      });
      if (bold) { row.font = { bold: true }; row.border = { top: { style: "thin" } }; }
    };
    sec.rows.forEach((r) => write(r));
    (sec.totals ?? []).forEach((r) => write(r, true));
    ws.addRow([]);
  }

  if (model.narrative) {
    ws.addRow(["Narrative by Nena"]).font = { bold: true, color: { argb: "FF7C3AED" } };
    for (const para of model.narrative.split(/\n\s*\n/)) {
      const r = ws.addRow([para.trim()]);
      ws.mergeCells(r.number, 1, r.number, maxCols);
      r.alignment = { wrapText: true, vertical: "top" };
      r.height = Math.min(200, 15 * Math.ceil(para.length / 110));
    }
  }

  for (let i = 1; i <= maxCols; i++) ws.getColumn(i).width = i === 1 ? 28 : 18;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

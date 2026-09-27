"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { REPORT_TYPES, REPORT_LABELS, type ReportType } from "@/lib/reports/build";
import type { ReceiptExtraction } from "@/lib/nena/receipt";
import { ExcelSheet } from "@/components/reports/ExcelSheet";
import {
  buildSalesSummary,
  combineSales,
  parseSalesCsv,
  salesRowsToCsv,
  salesSummaryToCsv,
  type GroupTotal,
  type SalesCsvRow,
} from "@/lib/reports/csv-sales";

const VISIBLE_TYPES = REPORT_TYPES.filter((type) => !type.startsWith("bir-"));

export function GenerateReportButton() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ReportType | null>(null);

  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded bg-nena px-3 py-1.5 text-sm text-white"
      >
        Generate report
      </button>

      {open && (
        <ul className="mt-3 divide-y divide-slate-200 rounded border border-slate-200">
          {VISIBLE_TYPES.map((type) => (
            <li key={type}>
              <button
                onClick={() => setActive((v) => (v === type ? null : type))}
                className="w-full px-4 py-2 text-left text-sm text-ink hover:bg-slate-50"
              >
                {REPORT_LABELS[type]}
              </button>

              {active === type && (
                <div className="px-4 pb-3">
                  <FileDropzone type={type} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Result = { extraction: ReceiptExtraction; flags: string[] };
type Item = { id: number; file: File; status: "sending" | "done" | "error"; result?: Result; error?: string };

let nextId = 0;

/**
 * One dropzone for any file. Every file goes to Nena first; if she signals she can't
 * read it (not an image — no Gemini call spent finding that out), the system takes
 * over immediately and parses it as a sales CSV instead. No error for the handoff.
 */
function FileDropzone({ type }: { type: ReportType }) {
  const [dragOver, setDragOver] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [rowsByFile, setRowsByFile] = useState<Record<string, SalesCsvRow[]>>({});

  const fallbackToCsv = async (file: File, id: number) => {
    try {
      const rows = parseSalesCsv(await file.text(), file.name);
      setRowsByFile((prev) => ({ ...prev, [file.name]: rows }));
      setItems((prev) => prev.filter((it) => it.id !== id));
    } catch {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "error", error: "Couldn't read this file." } : it)));
    }
  };

  const submitOne = async (file: File, id: number) => {
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/nena/receipt", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong");
      if (json.unreadable) return fallbackToCsv(file, id);
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "done", result: json } : it)));
    } catch (e) {
      const error = e instanceof Error ? e.message : "Something went wrong";
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "error", error } : it)));
    }
  };

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const id = nextId++;
      setItems((prev) => [...prev, { id, file, status: "sending" }]);
      submitOne(file, id);
    }
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const removeItem = (id: number) => setItems((prev) => prev.filter((it) => it.id !== id));
  const removeFile = (name: string) =>
    setRowsByFile((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });

  const fileNames = Object.keys(rowsByFile);
  const allRows = Object.values(rowsByFile).flat();
  const summary = allRows.length > 0 ? combineSales(allRows) : null;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const hasResults = items.length > 0 || fileNames.length > 0;
  useEffect(() => {
    if (hasResults && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [items.length, fileNames.length]);

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed p-6 text-sm ${
          dragOver ? "border-nena bg-slate-50" : "border-slate-300"
        }`}
      >
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="text-ink-muted">Drop files here, or click to browse — submit to Nena</span>
      </label>

      {fileNames.length > 0 && (
        <div className="mt-3 divide-y divide-slate-200 rounded border border-slate-200 text-sm">
          {fileNames.map((name) => (
            <div key={name} className="flex items-center justify-between px-3 py-1.5">
              <span className="text-ink-muted">
                {name} <span className="text-ink-faint">· {rowsByFile[name].length} rows</span>
              </span>
              <button onClick={() => removeFile(name)} className="text-ink-faint hover:text-ink" aria-label={`Remove ${name}`}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {hasResults && (
        <button
          onClick={() => dialogRef.current?.showModal()}
          className="mt-3 text-sm text-nena underline"
        >
          View results
        </button>
      )}

      <dialog
        ref={dialogRef}
        className="w-full max-w-lg rounded-lg p-0 backdrop:bg-black/40"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="max-h-[80vh] overflow-y-auto p-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-ink">Results</p>
            <button onClick={() => dialogRef.current?.close()} className="text-ink-muted hover:text-ink" aria-label="Close">
              ×
            </button>
          </div>

          {summary && type === "sales-summary" && (
            <>
              <SalesSummaryView rowsByFile={rowsByFile} />
              <CsvExport filename={`summary-of-sales-${Date.now()}.csv`} csv={salesSummaryToCsv(buildSalesSummary(rowsByFile))} />
            </>
          )}

          {summary && type !== "sales-summary" && (
            <>
              <div className="mt-3 rounded border border-slate-200 p-4">
                <p className="text-xs text-ink-muted">
                  {summary.byFile.length} file{summary.byFile.length === 1 ? "" : "s"} · {summary.rows.length} lines
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">₱{summary.totalAmount.toLocaleString()}</p>

                <BarBreakdown title="By category" rows={summary.byCategory} />
                <BarBreakdown title="By month" rows={summary.byMonth} />
              </div>
              <CsvExport filename={`sales-report-${Date.now()}.csv`} csv={salesRowsToCsv(summary.rows)} />
            </>
          )}

          {items.length > 0 && (
            <ul className="mt-3 space-y-2">
              {items.map((it) => (
                <li key={it.id} className="rounded border border-slate-200 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-ink">{it.file.name}</p>
                    <button onClick={() => removeItem(it.id)} className="text-ink-muted hover:text-ink" aria-label={`Remove ${it.file.name}`}>
                      ×
                    </button>
                  </div>
                  {it.status === "sending" && <p className="text-ink-muted">Nena is reading it…</p>}
                  {it.status === "error" && <p className="text-red-600">{it.error}</p>}
                  {it.status === "done" && it.result && (
                    <>
                      <p className="text-ink-muted">
                        {it.result.extraction.vendor} · {it.result.extraction.date ?? "date unknown"} · ₱
                        {it.result.extraction.totalAmount ?? "?"} · {it.result.extraction.suggestedCategory}
                      </p>
                      {it.result.flags.length > 0 && (
                        <p className="mt-1 text-amber-600">Needs attention: {it.result.flags.join(", ")}</p>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </dialog>
    </div>
  );
}

/** Thin single-hue bars sized to the largest row — labels carry identity, color carries magnitude. */
function BarBreakdown({ title, rows }: { title: string; rows: GroupTotal[] }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.amount));

  return (
    <div className="mt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{title}</p>
      <div className="mt-2 space-y-2">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink-muted">{r.label}</span>
              <span className="tabular-nums text-ink">₱{r.amount.toLocaleString()}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-nena-soft">
              <div
                className="h-1.5 rounded-full bg-nena"
                style={{ width: `${Math.max((r.amount / max) * 100, 4)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Replicates the reference "Summary of Sales Report" layout: per-company breakdowns, then a portfolio rollup. */
function SalesSummaryView({ rowsByFile }: { rowsByFile: Record<string, SalesCsvRow[]> }) {
  const report = buildSalesSummary(rowsByFile);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <div className="mt-3 space-y-4">
      {report.companies.map((c) => (
        <div key={c.source} className="rounded border border-slate-200 p-4">
          <p className="font-semibold text-ink">{c.company}</p>

          <div className="mt-2">
            <ExcelSheet
              sheetName={c.company}
              columns={[
                { key: "category", label: "Category" },
                { key: "units", label: "Units", align: "right" },
                { key: "amount", label: "Amount", align: "right" },
                { key: "pct", label: "%", align: "right" },
              ]}
              rows={c.categories.map((cat) => ({
                category: cat.category,
                units: cat.units,
                amount: `₱${cat.amount.toLocaleString()}`,
                pct: pct(cat.pctOfCompany),
              }))}
              totalRow={{ category: "Total", units: c.unitsSold, amount: `₱${c.salesAmount.toLocaleString()}`, pct: "100.0%" }}
            />
          </div>

          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-faint">Payment method</p>
          <div className="mt-1">
            <ExcelSheet
              sheetName="Payment method"
              columns={[
                { key: "method", label: "Method" },
                { key: "amount", label: "Amount", align: "right" },
                { key: "pct", label: "%", align: "right" },
              ]}
              rows={c.payments.map((p) => ({ method: p.method, amount: `₱${p.amount.toLocaleString()}`, pct: pct(p.pctOfCompany) }))}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1 text-xs text-ink-muted">
            <span>Transactions: {c.transactions}</span>
            <span>Units sold: {c.unitsSold}</span>
            <span>Sales amount: ₱{c.salesAmount.toLocaleString()}</span>
            <span>Avg. transaction: ₱{c.avgTransactionValue.toFixed(2)}</span>
          </div>
        </div>
      ))}

      <div className="rounded border border-slate-200 p-4">
        <p className="font-semibold text-ink">Consolidated Summary — All Client Companies</p>
        <div className="mt-2">
          <ExcelSheet
            sheetName="Consolidated Summary"
            columns={[
              { key: "company", label: "Client Company" },
              { key: "total", label: "Total Sales", align: "right" },
              { key: "pct", label: "% of Portfolio", align: "right" },
            ]}
            rows={report.portfolio.map((p) => ({ company: p.company, total: `₱${p.totalSales.toLocaleString()}`, pct: pct(p.pctOfPortfolio) }))}
            totalRow={{ company: "Grand Total", total: `₱${report.grandTotal.toLocaleString()}`, pct: "100.0%" }}
          />
        </div>
      </div>
    </div>
  );
}

/** Builds a downloadable CSV from already-computed text, with a scrollable preview. */
function CsvExport({ csv, filename }: { csv: string; filename: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    setUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, [csv]);

  const allLines = csv.split("\n").filter(Boolean).map((l) => l.split(","));
  const [header, ...dataLines] = allLines;
  const previewRows = dataLines.slice(0, 20);
  const truncated = dataLines.length > previewRows.length;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Report preview</p>
        {url && (
          <a href={url} download={filename} className="rounded bg-nena px-3 py-1 text-xs text-white">
            Download CSV
          </a>
        )}
      </div>
      <div className="mt-2">
        <ExcelSheet
          sheetName={filename}
          columns={(header ?? []).map((label, i) => ({ key: String(i), label }))}
          rows={previewRows.map((cells) => Object.fromEntries(cells.map((v, i) => [String(i), v])))}
        />
      </div>
      {truncated && <p className="mt-1 text-xs text-ink-faint">Showing first {previewRows.length} of {dataLines.length} rows — full report is in the download.</p>}
    </div>
  );
}

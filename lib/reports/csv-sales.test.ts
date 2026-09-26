import { describe, expect, it } from "vitest";
import { buildSalesSummary, combineSales, parseSalesCsv, salesRowsToCsv, salesSummaryToCsv } from "./csv-sales";

const csvA = `Date,Invoice No,Customer Name,Item/Description,Quantity,Unit Price,Amount,Payment Method,Category
2026-09-01,SVC-1,Grace,Haircut,1,250.00,250.00,Cash,Salon Service
2026-09-02,SVC-2,Neil,Haircut,1,120.00,120.00,Cash,Salon Service`;

const csvB = `Date,Invoice No,Customer Name,Item/Description,Quantity,Unit Price,Amount,Payment Method,Category
2026-09-01,OR-1,Aling Rosa,Rice,5,58.00,290.00,Cash,Sari-Sari Sales`;

describe("parseSalesCsv", () => {
  it("parses rows into typed fields", () => {
    const rows = parseSalesCsv(csvA, "a.csv");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2026-09-01", customer: "Grace", amount: 250, category: "Salon Service", source: "a.csv" });
  });
});

describe("combineSales", () => {
  it("merges rows from multiple files into one summary", () => {
    const rows = [...parseSalesCsv(csvA, "a.csv"), ...parseSalesCsv(csvB, "b.csv")];
    const summary = combineSales(rows);
    expect(summary.totalAmount).toBe(250 + 120 + 290);
    expect(summary.byFile.map((f) => f.label).sort()).toEqual(["a.csv", "b.csv"]);
    expect(summary.byCategory.find((c) => c.label === "Salon Service")?.amount).toBe(370);
  });
});

describe("buildSalesSummary", () => {
  it("matches the reference Summary of Sales Report layout", () => {
    const rowsByFile = {
      "sales_data_bellas_salon.csv": parseSalesCsv(csvA, "sales_data_bellas_salon.csv"),
      "sales_data_juans_saristore.csv": parseSalesCsv(csvB, "sales_data_juans_saristore.csv"),
    };
    const report = buildSalesSummary(rowsByFile);

    const bellas = report.companies.find((c) => c.source === "sales_data_bellas_salon.csv")!;
    expect(bellas.company).toBe("Bellas Salon");
    expect(bellas.transactions).toBe(2);
    expect(bellas.unitsSold).toBe(2);
    expect(bellas.salesAmount).toBe(370);
    expect(bellas.avgTransactionValue).toBe(185);
    expect(bellas.categories).toEqual([{ category: "Salon Service", units: 2, amount: 370, pctOfCompany: 1 }]);
    expect(bellas.payments).toEqual([{ method: "Cash", amount: 370, pctOfCompany: 1 }]);

    expect(report.grandTotal).toBe(660);
    expect(report.portfolio).toEqual([
      { company: "Bellas Salon", totalSales: 370, pctOfPortfolio: 370 / 660 },
      { company: "Juans Saristore", totalSales: 290, pctOfPortfolio: 290 / 660 },
    ]);

    const csv = salesSummaryToCsv(report);
    expect(csv).toContain("Bellas Salon");
    expect(csv).toContain("Salon Service,2,370,100.0%");
    expect(csv).toContain("Consolidated Summary - All Client Companies");
    expect(csv).toContain("Grand Total,660,100.0%");
  });
});

describe("salesRowsToCsv", () => {
  it("quotes fields containing commas", () => {
    const rows = parseSalesCsv(csvA, "a.csv");
    rows[0].item = "Haircut, Ladies";
    const csv = salesRowsToCsv(rows);
    expect(csv.split("\n")[1]).toContain('"Haircut, Ladies"');
  });
});

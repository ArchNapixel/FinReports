import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatPdf, type Centavos } from "@/lib/money";

export interface PayslipData {
  company: { name: string; TIN: string; address: string };
  period: string; // YYYY-MM
  employee: { name: string; TIN: string; SSS_no: string; PhilHealth_no: string; PagIBIG_no: string };
  gross: Centavos;
  sss: Centavos;
  philhealth: Centavos;
  pagibig: Centavos;
  withholding_tax: Centavos;
  net_pay: Centavos;
  employer: { sss: Centavos; ec: Centavos; philhealth: Centavos; pagibig: Centavos };
}

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
  slip: { borderWidth: 0.8, borderColor: "#0f172a", padding: 12, marginBottom: 14 },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  company: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  muted: { color: "#475569", fontSize: 8 },
  title: { fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "right" },
  grid: { flexDirection: "row", gap: 14 },
  col: { flex: 1 },
  label: { fontFamily: "Helvetica-Bold", fontSize: 8.5, borderBottomWidth: 0.6, borderBottomColor: "#0f172a", marginBottom: 3, paddingBottom: 1 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  total: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, borderTopWidth: 0.6, borderTopColor: "#0f172a", fontFamily: "Helvetica-Bold", marginTop: 2 },
  net: { marginTop: 8, flexDirection: "row", justifyContent: "space-between", backgroundColor: "#f1f5f9", padding: 6, fontSize: 11, fontFamily: "Helvetica-Bold" },
});

const monthName = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });

function Line({ label, value }: { label: string; value: Centavos }) {
  return (
    <View style={s.line}>
      <Text>{label}</Text>
      <Text>{formatPdf(value)}</Text>
    </View>
  );
}

function Slip({ d }: { d: PayslipData }) {
  const deductions = d.sss + d.philhealth + d.pagibig + d.withholding_tax;
  return (
    <View style={s.slip} wrap={false}>
      <View style={s.head}>
        <View>
          <Text style={s.company}>{d.company.name}</Text>
          {d.company.TIN ? <Text style={s.muted}>TIN {d.company.TIN}</Text> : null}
          {d.company.address ? <Text style={s.muted}>{d.company.address}</Text> : null}
        </View>
        <View>
          <Text style={s.title}>PAYSLIP</Text>
          <Text style={[s.muted, { textAlign: "right" }]}>{monthName(d.period)}</Text>
        </View>
      </View>
      <View style={[s.grid, { marginBottom: 8 }]}>
        <View style={s.col}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.employee.name}</Text>
          <Text style={s.muted}>TIN {d.employee.TIN || "—"}</Text>
        </View>
        <View style={s.col}>
          <Text style={s.muted}>SSS {d.employee.SSS_no || "—"} · PhilHealth {d.employee.PhilHealth_no || "—"}</Text>
          <Text style={s.muted}>Pag-IBIG {d.employee.PagIBIG_no || "—"}</Text>
        </View>
      </View>
      <View style={s.grid}>
        <View style={s.col}>
          <Text style={s.label}>Earnings</Text>
          <Line label="Basic salary" value={d.gross} />
          <View style={s.total}><Text>Gross pay</Text><Text>{formatPdf(d.gross)}</Text></View>
        </View>
        <View style={s.col}>
          <Text style={s.label}>Deductions</Text>
          <Line label="SSS (EE)" value={d.sss} />
          <Line label="PhilHealth (EE)" value={d.philhealth} />
          <Line label="Pag-IBIG (EE)" value={d.pagibig} />
          <Line label="Withholding tax" value={d.withholding_tax} />
          <View style={s.total}><Text>Total deductions</Text><Text>{formatPdf(deductions)}</Text></View>
        </View>
      </View>
      <View style={s.net}><Text>NET PAY</Text><Text>PHP {formatPdf(d.net_pay)}</Text></View>
      <Text style={[s.muted, { marginTop: 6 }]}>
        Employer share (not deducted): SSS {formatPdf(d.employer.sss)} + EC {formatPdf(d.employer.ec)} · PhilHealth {formatPdf(d.employer.philhealth)} · Pag-IBIG {formatPdf(d.employer.pagibig)}
      </Text>
    </View>
  );
}

/** Two payslips per A4 page. */
export function renderPayslipsPdf(slips: PayslipData[]): Promise<Buffer> {
  const pages: PayslipData[][] = [];
  for (let i = 0; i < slips.length; i += 2) pages.push(slips.slice(i, i + 2));
  return renderToBuffer(
    <Document title={`Payslips ${slips[0]?.period ?? ""}`} author="FinReports">
      {pages.map((pg, i) => (
        <Page key={i} size="A4" style={s.page}>
          {pg.map((d, j) => <Slip key={j} d={d} />)}
        </Page>
      ))}
    </Document>,
  );
}

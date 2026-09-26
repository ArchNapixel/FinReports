import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatPdf } from "@/lib/money";
import type { Cell, Column, ReportModel, Section } from "@/lib/reports/model";

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 8.5, fontFamily: "Helvetica", color: "#0f172a" },
  company: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  meta: { fontSize: 8, color: "#475569", marginTop: 1 },
  title: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 10 },
  period: { fontSize: 8.5, color: "#475569", marginBottom: 8 },
  warning: { backgroundColor: "#fef3c7", padding: 5, marginBottom: 6, fontSize: 8 },
  heading: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 3 },
  note: { fontSize: 7.5, color: "#475569", marginBottom: 3 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#0f172a", paddingBottom: 2, marginBottom: 1 },
  row: { flexDirection: "row", paddingVertical: 1.5, borderBottomWidth: 0.3, borderBottomColor: "#e2e8f0" },
  totalRow: { flexDirection: "row", paddingVertical: 2, borderTopWidth: 0.8, borderTopColor: "#0f172a", fontFamily: "Helvetica-Bold" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5, paddingHorizontal: 2 },
  td: { paddingHorizontal: 2 },
  narrativeBox: { marginTop: 14, borderLeftWidth: 2, borderLeftColor: "#7c3aed", paddingLeft: 8 },
  narrativeLabel: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: "#7c3aed", marginBottom: 4 },
  narrative: { fontSize: 9, lineHeight: 1.45 },
  footer: { position: "absolute", bottom: 18, left: 32, right: 32, fontSize: 7, color: "#94a3b8", flexDirection: "row", justifyContent: "space-between" },
});

function fmt(col: Column, v: Cell, section: Section): string {
  if (v === null || v === undefined || v === "") return "";
  const moneyish = col.money || (section.variant === "form" && col.key === "value");
  if (moneyish && typeof v === "number") return formatPdf(v);
  return String(v);
}

function Row({ section, row, style }: { section: Section; row: Record<string, Cell>; style: typeof s.row | typeof s.totalRow }) {
  return (
    <View style={style} wrap={false}>
      {section.columns.map((c) => (
        <Text key={c.key} style={[s.td, { flex: c.width ?? 1, textAlign: c.align ?? (section.variant === "form" && c.key === "value" ? "right" : "left") }]}>
          {fmt(c, row[c.key] ?? null, section)}
        </Text>
      ))}
    </View>
  );
}

function SectionView({ section }: { section: Section }) {
  const hasBody = section.rows.length > 0 || (section.totals?.length ?? 0) > 0;
  return (
    <View>
      {section.heading ? <Text style={s.heading} minPresenceAhead={40}>{section.heading}</Text> : null}
      {section.note ? <Text style={s.note}>{section.note}</Text> : null}
      {hasBody && section.rows.length > 0 ? (
        <View style={s.headRow}>
          {section.columns.map((c) => (
            <Text key={c.key} style={[s.th, { flex: c.width ?? 1, textAlign: c.align ?? (section.variant === "form" && c.key === "value" ? "right" : "left") }]}>{c.label}</Text>
          ))}
        </View>
      ) : null}
      {section.rows.map((r, i) => <Row key={i} section={section} row={r} style={s.row} />)}
      {(section.totals ?? []).map((r, i) => <Row key={`t${i}`} section={section} row={r} style={s.totalRow} />)}
    </View>
  );
}

export function ReportDocument({ model }: { model: ReportModel }) {
  const landscape = model.sections.some((sec) => sec.columns.length > 7);
  return (
    <Document title={`${model.title} — ${model.company.name}`} author="FinReports" creator="FinReports">
      <Page size="A4" orientation={landscape ? "landscape" : "portrait"} style={s.page}>
        <Text style={s.company}>{model.company.name}</Text>
        {model.company.TIN ? <Text style={s.meta}>TIN {model.company.TIN}{model.company.rdo ? ` · RDO ${model.company.rdo}` : ""}</Text> : null}
        {model.company.address ? <Text style={s.meta}>{model.company.address}</Text> : null}
        <Text style={s.title}>{model.title}</Text>
        <Text style={s.period}>{model.periodLabel}</Text>
        {(model.warnings ?? []).map((w, i) => <Text key={i} style={s.warning}>{w}</Text>)}
        {model.sections.map((sec, i) => <SectionView key={i} section={sec} />)}
        {model.narrative ? (
          <View style={s.narrativeBox} wrap={false}>
            <Text style={s.narrativeLabel}>Narrative by Nena</Text>
            {model.narrative.split(/\n\s*\n/).map((para, i) => <Text key={i} style={[s.narrative, { marginBottom: 4 }]}>{para.trim()}</Text>)}
            <Text style={[s.note, { marginTop: 2 }]}>AI-drafted from the figures above; review before issuing.</Text>
          </View>
        ) : null}
        {model.footnote ? <Text style={[s.note, { marginTop: 10 }]}>{model.footnote}</Text> : null}
        <View style={s.footer} fixed>
          <Text>Generated {model.generatedAt} by FinReports · Prepared for review by the accountant; not filed with the BIR.</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderReportPdf(model: ReportModel): Promise<Buffer> {
  return renderToBuffer(<ReportDocument model={model} />);
}

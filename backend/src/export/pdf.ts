import PDFDocument from 'pdfkit';
import { KPI_DEFINITIONS } from '../domain/definitions.js';
import type { Report } from '../domain/kpi.js';
import { buildRecommendations } from '../domain/recommendations.js';
import { duplicateModeLabel } from './tables.js';

const BRAND = '#1e3a8a';
const MUTED = '#64748b';
const INK = '#0f172a';
const LINE = '#e2e8f0';
const MARGIN = 40;

// Standard PDF fonts only cover Latin-1; replace anything else so text never renders as garbage.
const latin = (s: string) =>
  s
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\u2192/g, '->')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

function fmt(v: number | null | undefined, kind: 'int' | 'pct' | 'money' | 'num', currency: string): string {
  if (v === null || v === undefined) return 'N/A';
  if (kind === 'int') return Math.round(v).toLocaleString('en-IN');
  if (kind === 'pct') return `${v.toFixed(1)}%`;
  if (kind === 'money') return `${currency} ${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

interface Col {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

export function buildPdf(report: Report): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: 'Daily Lead KPI & KPM Report', Creator: 'LeadPulse Analytics' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const cur = report.currency;
    const W = doc.page.width - MARGIN * 2;
    const bottom = () => doc.page.height - MARGIN - 20;
    const ensure = (h: number) => {
      if (doc.y + h > bottom()) doc.addPage();
    };
    const heading = (t: string) => {
      ensure(60);
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(13).fillColor(BRAND).text(t, MARGIN, doc.y);
      doc.moveTo(MARGIN, doc.y + 2).lineTo(MARGIN + W, doc.y + 2).strokeColor(LINE).lineWidth(1).stroke();
      doc.moveDown(0.5);
    };
    const para = (t: string, color = INK, size = 9) => {
      doc.font('Helvetica').fontSize(size).fillColor(color).text(latin(t), MARGIN, doc.y, { width: W });
    };
    const table = (cols: Col[], rows: string[][]) => {
      const rowH = 16;
      const drawHeader = () => {
        let x = MARGIN;
        doc.rect(MARGIN, doc.y, W, rowH).fill('#eef2fb');
        const y = doc.y + 4;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK);
        for (const c of cols) {
          doc.text(c.header, x + 3, y, { width: c.width - 6, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
          x += c.width;
        }
        doc.y = y - 4 + rowH;
      };
      ensure(rowH * 3);
      drawHeader();
      rows.forEach((r, ri) => {
        if (doc.y + rowH > bottom()) {
          doc.addPage();
          drawHeader();
        }
        const y = doc.y;
        if (ri % 2 === 1) doc.rect(MARGIN, y, W, rowH).fill('#f8fafc');
        let x = MARGIN;
        doc.font('Helvetica').fontSize(7.5).fillColor(INK);
        r.forEach((v, i) => {
          doc.text(latin(v), x + 3, y + 4, { width: cols[i].width - 6, align: cols[i].align ?? 'left', lineBreak: false, ellipsis: true });
          x += cols[i].width;
        });
        doc.y = y + rowH;
      });
      doc.x = MARGIN;
    };

    // Header
    const period = report.period.isRange ? `${report.period.from} to ${report.period.to}` : report.period.from;
    doc.rect(0, 0, doc.page.width, 78).fill(BRAND);
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff').text('Daily Lead KPI & KPM Report', MARGIN, 22);
    doc.font('Helvetica').fontSize(10).fillColor('#dbe4ff').text(`Reporting period: ${period}    Generated: ${report.generatedAt.replace('T', ' ').slice(0, 16)} UTC`, MARGIN, 48);
    doc.y = 92;
    para(`Duplicate handling: ${duplicateModeLabel(report.settings.duplicateMode)}. Date filter: ${report.settings.dateFilter === 'restrict' ? 'reporting period only' : 'all rows (out-of-period rows flagged)'}.${report.settings.filters.campaigns.length || report.settings.filters.sources.length ? ` Filters: ${[...report.settings.filters.campaigns, ...report.settings.filters.sources].join(', ')}.` : ''}`, MUTED, 8.5);

    // KPI cards
    heading('Key metrics');
    const cards: [string, string, string][] = [
      ['Total leads', fmt(report.overview.totalLeads, 'int', cur), `${fmt(report.counts.rawRows, 'int', cur)} raw rows`],
      ['Unique leads', fmt(report.overview.uniqueLeads, 'int', cur), `${fmt(report.counts.duplicateRows, 'int', cur)} duplicate rows`],
      ['Qualified leads', fmt(report.overview.qualifiedLeads, 'int', cur), report.sales.qualificationRate !== null ? `${fmt(report.sales.qualificationRate, 'pct', cur)} qualification rate` : 'Not available'],
      ['Total ad spend', fmt(report.overview.totalSpend, 'money', cur), report.overview.totalSpend === null ? 'No spend provided' : `${fmt(report.marketing.attributableSpend, 'money', cur)} attributable`],
      ['CPL', fmt(report.overview.cpl, 'money', cur), report.overview.cpl === null ? 'Not available' : `${fmt(report.marketing.attributableLeads, 'int', cur)} attributable leads`],
      ['Applications', fmt(report.overview.applications, 'int', cur), report.conversion.applicationRate !== null ? `${fmt(report.conversion.applicationRate, 'pct', cur)} conversion` : 'Not available'],
      ['Enrolments', fmt(report.overview.enrolments, 'int', cur), report.conversion.enrolmentRate !== null ? `${fmt(report.conversion.enrolmentRate, 'pct', cur)} conversion` : 'Not available'],
      ['Target achievement', fmt(report.overview.targetAchievement, 'pct', cur), report.marketing.targetLeads !== null ? `Target ${fmt(report.marketing.targetLeads, 'int', cur)} leads` : 'No target entered'],
    ];
    const cw = (W - 3 * 8) / 4;
    const ch = 54;
    ensure(ch * 2 + 20);
    const top = doc.y;
    cards.forEach(([label, value, sub], i) => {
      const x = MARGIN + (i % 4) * (cw + 8);
      const y = top + Math.floor(i / 4) * (ch + 8);
      doc.roundedRect(x, y, cw, ch, 4).fillAndStroke('#ffffff', LINE);
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), x + 8, y + 7, { width: cw - 16 });
      doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(value, x + 8, y + 19, { width: cw - 16, lineBreak: false, ellipsis: true });
      doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(latin(sub), x + 8, y + 38, { width: cw - 16, lineBreak: false, ellipsis: true });
    });
    doc.y = top + 2 * (ch + 8);
    doc.x = MARGIN;

    // Upload summary
    heading('Upload summary');
    table(
      [
        { header: 'File', width: 175 },
        { header: 'Type', width: 50 },
        { header: 'Rows', width: 45, align: 'right' },
        { header: 'Accepted', width: 50, align: 'right' },
        { header: 'Rejected', width: 50, align: 'right' },
        { header: 'In report', width: 50, align: 'right' },
        { header: 'Unique', width: 45, align: 'right' },
        { header: 'Duplicates', width: 50, align: 'right' },
      ],
      report.files.map((f) => [f.fileName, f.kind === 'leads' ? 'Leads' : 'Ad spend', fmt(f.dataRows, 'int', cur), fmt(f.accepted, 'int', cur), fmt(f.rejected, 'int', cur), fmt(f.inReport, 'int', cur), f.kind === 'leads' ? fmt(f.uniqueLeads, 'int', cur) : '-', fmt(f.duplicateRows, 'int', cur)]),
    );

    // Campaigns
    heading('Campaign performance');
    const camps = report.campaigns.slice(0, 25);
    table(
      [
        { header: 'Campaign', width: 150 },
        { header: 'Leads', width: 40, align: 'right' },
        { header: 'Qualified', width: 45, align: 'right' },
        { header: 'Qual. %', width: 42, align: 'right' },
        { header: 'Spend', width: 62, align: 'right' },
        { header: 'CPL', width: 55, align: 'right' },
        { header: 'Apps', width: 37, align: 'right' },
        { header: 'Enrolled', width: 42, align: 'right' },
        { header: 'Target', width: 42, align: 'right' },
      ],
      camps.map((c) => [c.label, fmt(c.leads, 'int', cur), fmt(c.qualified, 'int', cur), fmt(c.qualificationRate, 'pct', cur), fmt(c.spend, 'money', cur), fmt(c.cpl, 'money', cur), fmt(c.applications, 'int', cur), fmt(c.enrolments, 'int', cur), fmt(c.targetAchievement, 'pct', cur)]),
    );
    if (report.campaigns.length > camps.length) para(`Showing top ${camps.length} of ${report.campaigns.length} campaigns by lead volume. The Excel export contains all campaigns.`, MUTED, 8);

    // Sources
    heading('Source performance');
    table(
      [
        { header: 'Source', width: 150 },
        { header: 'Leads', width: 50, align: 'right' },
        { header: 'Share', width: 50, align: 'right' },
        { header: 'Qualified', width: 55, align: 'right' },
        { header: 'Spend', width: 70, align: 'right' },
        { header: 'CPL', width: 60, align: 'right' },
        { header: 'Apps', width: 35, align: 'right' },
        { header: 'Enrolled', width: 45, align: 'right' },
      ],
      report.sources.slice(0, 20).map((s) => [s.label, fmt(s.leads, 'int', cur), fmt(s.share, 'pct', cur), fmt(s.qualified, 'int', cur), fmt(s.spend, 'money', cur), fmt(s.cpl, 'money', cur), fmt(s.applications, 'int', cur), fmt(s.enrolments, 'int', cur)]),
    );

    // Sales
    heading('Sales performance');
    const s = report.sales;
    para(
      `Assigned: ${fmt(s.assigned, 'int', cur)}   Contacted: ${fmt(s.contacted, 'int', cur)}   Contact rate: ${fmt(s.contactRate, 'pct', cur)}   Median first response: ${s.firstResponse?.medianMinutes !== null && s.firstResponse?.medianMinutes !== undefined ? `${s.firstResponse.medianMinutes} min` : 'N/A'}   Follow-ups due: ${fmt(s.followUpsDue, 'int', cur)} (completed ${fmt(s.followUpsCompleted, 'int', cur)}, overdue ${fmt(s.followUpsOverdue, 'int', cur)})`,
    );
    doc.moveDown(0.4);
    if (report.counsellors.length) {
      table(
        [
          { header: 'Counsellor', width: 130 },
          { header: 'Leads', width: 40, align: 'right' },
          { header: 'Contact %', width: 50, align: 'right' },
          { header: 'Qualified', width: 48, align: 'right' },
          { header: 'Med. resp (min)', width: 62, align: 'right' },
          { header: 'FU due', width: 40, align: 'right' },
          { header: 'Overdue', width: 42, align: 'right' },
          { header: 'Apps', width: 50, align: 'right' },
          { header: 'Enrolled', width: 53, align: 'right' },
        ],
        report.counsellors.slice(0, 25).map((c) => [c.counsellor, fmt(c.leads, 'int', cur), fmt(c.contactRate, 'pct', cur), fmt(c.qualified, 'int', cur), c.medianFirstResponseMinutes === null ? 'N/A' : String(c.medianFirstResponseMinutes), fmt(c.followUpsDue, 'int', cur), fmt(c.followUpsOverdue, 'int', cur), fmt(c.applications, 'int', cur), fmt(c.enrolments, 'int', cur)]),
      );
    } else para('Counsellor data is not available: no Assigned Counsellor column is mapped.', MUTED);

    // Funnel
    heading('Lead funnel');
    const stages = report.funnel;
    const max = Math.max(1, ...stages.map((st) => st.count ?? 0));
    const labelW = 95;
    const barMax = W - labelW - 120;
    ensure(stages.length * 20 + 10);
    for (const st of stages) {
      const y = doc.y;
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(st.label, MARGIN, y + 3, { width: labelW });
      if (st.available && st.count !== null) {
        const w = Math.max(2, (st.count / max) * barMax);
        doc.rect(MARGIN + labelW, y, w, 14).fill(BRAND);
        doc.font('Helvetica').fontSize(8).fillColor(INK).text(`${fmt(st.count, 'int', cur)}  (${fmt(st.pctOfReceived, 'pct', cur)})`, MARGIN + labelW + w + 6, y + 3, { width: 110 });
      } else {
        doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED).text('Not available - required columns not mapped', MARGIN + labelW, y + 3);
      }
      doc.y = y + 19;
    }
    doc.x = MARGIN;

    // Data quality
    heading('Data-quality findings');
    const d = report.dataQuality;
    const dq: [string, string][] = [
      ['Duplicate rows (confirmed)', `${fmt(report.counts.duplicateRows, 'int', cur)} (${fmt(d.duplicateRate, 'pct', cur)})`],
      ['Possible duplicates needing review', fmt(report.counts.possibleDuplicateRows, 'int', cur)],
      ['Rejected rows', fmt(d.rejectedRows, 'int', cur)],
      ['Rows with warnings', fmt(d.rowsWithWarnings, 'int', cur)],
      ['Missing / invalid phone', `${fmt(d.missingPhone, 'int', cur)} / ${fmt(d.invalidPhone, 'int', cur)}`],
      ['Missing / invalid email', `${fmt(d.missingEmail, 'int', cur)} / ${fmt(d.invalidEmail, 'int', cur)}`],
      ['Missing campaign attribution', fmt(d.missingCampaign, 'int', cur)],
      ['Missing counsellor assignment', fmt(d.missingCounsellor, 'int', cur)],
      ['Missing follow-up dates (open leads)', fmt(d.missingFollowUpDate, 'int', cur)],
      ['Conflicting records', fmt(d.conflictingRecords, 'int', cur)],
    ];
    table([{ header: 'Check', width: 260 }, { header: 'Result', width: W - 260, align: 'left' }], dq.map(([a, b]) => [a, b]));
    for (const n of report.notes) {
      ensure(24);
      doc.moveDown(0.2);
      para(`${n.level === 'warning' ? 'Warning' : 'Note'}: ${n.message}`, n.level === 'warning' ? '#9a3412' : MUTED, 8.5);
    }

    // Recommendations
    heading('Recommendations (rule-based)');
    const recs = buildRecommendations(report);
    if (!recs.length) para('No issues crossed the recommendation thresholds for this report.', MUTED);
    for (const r of recs) {
      ensure(30);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(`${r.area}: `, MARGIN, doc.y, { continued: true, width: W });
      doc.font('Helvetica').text(latin(`${r.finding} ${r.action}`));
      doc.moveDown(0.3);
    }

    // Calculation notes
    heading('Calculation notes');
    for (const k of ['totalLeads', 'uniqueLeads', 'qualificationRate', 'cpl', 'contactRate', 'applicationRate', 'duplicateRate', 'na']) {
      const def = KPI_DEFINITIONS.find((x) => x.key === k);
      if (!def) continue;
      ensure(26);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(`${def.name}: `, MARGIN, doc.y, { continued: true, width: W });
      doc.font('Helvetica').fillColor(INK).text(latin(`${def.formula}. ${def.notes}`));
      doc.moveDown(0.2);
    }

    // Footer with page numbers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would otherwise make pdfkit add a blank page.
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`LeadPulse Analytics - generated from a temporary reporting session. Page ${i + 1} of ${range.count}`, MARGIN, doc.page.height - MARGIN + 5, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

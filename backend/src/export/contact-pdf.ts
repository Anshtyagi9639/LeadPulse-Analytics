import PDFDocument from 'pdfkit';
import type { ContactReport } from '../domain/contact-report.js';

const BRAND = '#1f3864';
const MUTED = '#64748b';
const INK = '#0f172a';
const LINE = '#e2e8f0';
const M = 40;
// Standard PDF fonts cover Latin-1 only.
const latin = (s: string) => s.replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const int = (v: number | null) => (v === null ? 'N/A' : Math.round(v).toLocaleString('en-IN'));
const pctS = (v: number | null) => (v === null ? 'N/A' : `${v.toFixed(1)}%`);

/** PDF summary of the Lead Contact Report: KPIs, owners, stages, follow-ups, dispositions, last-worked days, notes. */
export function buildContactPdf(r: ContactReport, meta: { title: string; subtitle: string; processing: { label: string; value: string }[] }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: meta.title, Creator: 'LeadPulse Analytics' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - M * 2;
    const bottom = () => doc.page.height - M - 20;
    const ensure = (h: number) => {
      if (doc.y + h > bottom()) doc.addPage();
    };
    const heading = (t: string) => {
      ensure(60);
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(13).fillColor(BRAND).text(t, M, doc.y);
      doc.moveTo(M, doc.y + 2).lineTo(M + W, doc.y + 2).strokeColor(LINE).lineWidth(1).stroke();
      doc.moveDown(0.5);
    };
    const table = (cols: { h: string; w: number; right?: boolean }[], rows: string[][], boldLast = false) => {
      const rh = 16;
      const head = () => {
        doc.rect(M, doc.y, W, rh).fill('#eef2fb');
        const y = doc.y + 4;
        let x = M;
        doc.font('Helvetica-Bold').fontSize(8).fillColor(INK);
        for (const c of cols) {
          doc.text(c.h, x + 3, y, { width: c.w - 6, align: c.right ? 'right' : 'left', lineBreak: false, ellipsis: true });
          x += c.w;
        }
        doc.y = y - 4 + rh;
      };
      ensure(rh * 3);
      head();
      rows.forEach((row, i) => {
        if (doc.y + rh > bottom()) {
          doc.addPage();
          head();
        }
        const y = doc.y;
        if (i % 2) doc.rect(M, y, W, rh).fill('#f8fafc');
        let x = M;
        doc.font(boldLast && i === rows.length - 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(INK);
        row.forEach((v, j) => {
          doc.text(latin(v), x + 3, y + 4, { width: cols[j].w - 6, align: cols[j].right ? 'right' : 'left', lineBreak: false, ellipsis: true });
          x += cols[j].w;
        });
        doc.y = y + rh;
      });
      doc.x = M;
    };

    doc.rect(0, 0, doc.page.width, 78).fill(BRAND);
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff').text(latin(meta.title), M, 22, { width: W });
    doc.font('Helvetica').fontSize(10).fillColor('#dbe4ff').text(latin(meta.subtitle), M, 50, { width: W });
    doc.y = 92;

    heading('Key Numbers');
    const k = r.kpis;
    table(
      [
        { h: 'Metric', w: 360 },
        { h: 'Value', w: W - 360, right: true },
      ],
      [
        ['Total leads', int(k.totalLeads)],
        ['Leads not yet worked (NOT_WORKED)', int(k.notWorked)],
        ['Leads worked at least once', int(k.workedAtLeastOnce)],
        ['Qualified leads', int(k.qualified)],
        ['Qualification rate', pctS(k.qualificationRate)],
        ['Total attempts', int(k.totalAttempts)],
        ['Total calls', int(k.totalCalls)],
        ['Calls today', int(k.callsToday)],
        ['Leads marked INTERESTED', int(k.interested)],
        [`Overdue follow-ups (before ${r.reportDate})`, int(k.overdueFollowUps)],
        ['Follow-ups on/after report date', int(k.upcomingFollowUps)],
        ['Leads with no follow-up date', int(k.noFollowUpDate)],
      ],
    );

    if (r.owners.length) {
      heading('Performance by Lead Owner');
      const t = r.owners.reduce((a, o) => ({ leads: a.leads + o.leads, nw: a.nw + o.notWorked, q: a.q + o.qualified, c: a.c + o.totalCalls, d: a.d + o.callsToday }), { leads: 0, nw: 0, q: 0, c: 0, d: 0 });
      table(
        [
          { h: 'Lead Owner', w: 175 },
          { h: 'Leads', w: 68, right: true },
          { h: 'Not Worked', w: 68, right: true },
          { h: 'Qualified', w: 68, right: true },
          { h: 'Total Calls', w: 68, right: true },
          { h: 'Calls Today', w: W - 175 - 68 * 4, right: true },
        ],
        [...r.owners.map((o) => [o.owner, int(o.leads), int(o.notWorked), int(o.qualified), int(o.totalCalls), int(o.callsToday)]), ['Total', int(t.leads), int(t.nw), int(t.q), int(t.c), int(t.d)]],
        true,
      );
    }
    if (r.stages.length) {
      heading('Leads by Stage');
      table(
        [
          { h: 'Lead Stage', w: 300 },
          { h: 'Leads', w: 100, right: true },
          { h: '% of Total', w: W - 400, right: true },
        ],
        r.stages.map((s) => [s.stage, int(s.leads), pctS(s.pct)]),
      );
    }
    if (k.overdueFollowUps !== null) {
      heading('Follow-up Analysis');
      const tot = k.totalLeads || 1;
      table(
        [
          { h: 'Follow-up status', w: 300 },
          { h: 'Leads', w: 100, right: true },
          { h: '% of Total', w: W - 400, right: true },
        ],
        [
          ['Overdue (before report date)', int(k.overdueFollowUps), pctS((k.overdueFollowUps! / tot) * 100)],
          ['Due on or after report date', int(k.upcomingFollowUps), pctS((k.upcomingFollowUps! / tot) * 100)],
          ['No follow-up date', int(k.noFollowUpDate), pctS((k.noFollowUpDate! / tot) * 100)],
        ],
      );
    }
    if (r.dispositions.length) {
      heading('Lead Disposition (latest call result)');
      table(
        [
          { h: 'Disposition', w: 300 },
          { h: 'Leads', w: 100, right: true },
          { h: '% of Total', w: W - 400, right: true },
        ],
        r.dispositions.map((d) => [d.disposition, int(d.leads), pctS(d.pct)]),
      );
    }
    if (r.lastWorkedByDate.length) {
      heading('Leads Last Worked by Date');
      table(
        [
          { h: 'Date', w: 300 },
          { h: 'Leads', w: W - 300, right: true },
        ],
        r.lastWorkedByDate.map((d) => [d.date, int(d.leads)]),
      );
    }
    heading('Notes');
    for (const n of [...r.notes, ...(r.missingFields.length ? [`Not in the uploaded data (N/A): ${r.missingFields.join(', ')}.`] : [])]) {
      ensure(24);
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(latin(`- ${n}`), M, doc.y, { width: W });
      doc.moveDown(0.2);
    }
    heading('Processing details');
    table(
      [
        { h: 'Item', w: 200 },
        { h: 'Value', w: W - 200 },
      ],
      meta.processing.map((p) => [p.label, p.value]),
    );

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`LeadPulse Analytics - Lead Contact Report. Page ${i + 1} of ${range.count}`, M, doc.page.height - M + 5, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

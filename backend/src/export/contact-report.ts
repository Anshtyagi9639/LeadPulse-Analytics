import ExcelJS from 'exceljs';
import type { ContactReport } from '../domain/contact-report.js';
import { NO_DISPOSITION } from '../domain/contact-report.js';
import type { FileComparison } from '../domain/comparison.js';
import { isoDayToMs } from '../domain/normalize.js';
import { sanitizeCell } from '../lib/sanitize.js';
import { colLetter, evaluate, toSerial, type Grid, type Scalar } from './formula-eval.js';
import { addChartsToWorkbook, type ChartSpec } from './xlsx-charts.js';

/**
 * Builds the "Lead Contact Report" workbook in the layout of the SalesMax reference workbook:
 * Summary Report (live formulas over Full Data, report-date input cell, owner / stage / follow-up /
 * disposition / last-worked tables, notes, native charts) + Full Data + optional extra sheets.
 *
 * Every formula is evaluated against the exported Full Data before it is written; if it would not equal the
 * backend's figure, the verified value is written instead and listed in Processing Details.
 */
export type CellOut = string | number | Date | null;

export interface ExportColumn {
  /** Standard field key (e.g. "assignedCounsellor") or "orig:<header>" for an unmapped source column. */
  key: string;
  header: string;
  kind: 'text' | 'number' | 'date' | 'phone';
}

export interface ContactWorkbookInput {
  title: string;
  sourceLine: string;
  reportDate: string;
  generatedAtLabel: string;
  report: ContactReport;
  columns: ExportColumn[];
  rows: CellOut[][];
  /** Optional trailing status columns on Full Data (e.g. Source file, Status, Flags). */
  statusColumns: string[];
  statusRows: string[][];
  /** Stage labels counted as qualified (for the COUNTIF formulas). */
  qualifiedStageLabels: string[];
  extraSheets: { name: string; headers: string[]; rows: CellOut[][]; note?: string }[];
  comparison: FileComparison | null;
  processing: { label: string; value: string }[];
  processingTables: { title: string; headers: string[]; rows: CellOut[][] }[];
}

const NAVY = 'FF1F3864';
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 } as const;
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } } as const;
const SERIES = ['4F81BD', 'F79646', '9BBB59', '8064A2', '4BACC6', 'C0504D', 'F2C314', '7F7F7F'];

/**
 * Lead values are written as plain text cells, exactly as uploaded: ExcelJS stores strings as text, never as
 * formulas, so a value starting with "-", "+" or "=" cannot execute in this workbook. (CSV exports, which a
 * spreadsheet re-parses on open, keep formula-injection escaping.)
 */
const safe = (v: CellOut): CellOut => v;

export async function buildContactWorkbook(input: ContactWorkbookInput): Promise<{ buffer: Buffer; formulaFallbacks: string[] }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LeadPulse Analytics';
  wb.calcProperties = { fullCalcOnLoad: true };
  const S = 'Summary Report';
  const D = 'Full Data';
  const ws = wb.addWorksheet(S, { properties: { tabColor: { argb: NAVY } } });
  const fd = wb.addWorksheet(D);

  // ---------------------------------------------------------------- Full Data
  const n = input.rows.length;
  const allHeaders = [...input.columns.map((c) => c.header), ...input.statusColumns];
  fd.addRow(allHeaders).eachCell((c) => {
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
  });
  input.rows.forEach((row, i) => {
    const r = fd.getRow(i + 2);
    row.forEach((v, j) => {
      if (v === null || v === '') return;
      const c = r.getCell(j + 1);
      const kind = input.columns[j].kind;
      c.value = safe(v);
      if (v instanceof Date) c.numFmt = 'dd-mmm-yyyy hh:mm';
      else if (kind === 'phone' && typeof v === 'number') c.numFmt = '0';
      else if (typeof v === 'string' && /^\d+$/.test(v)) c.numFmt = '@'; // keep leading zeros
    });
    input.statusRows[i]?.forEach((v, j) => {
      if (v) r.getCell(input.columns.length + j + 1).value = safe(v) as string;
    });
  });
  allHeaders.forEach((h, i) => (fd.getColumn(i + 1).width = Math.min(34, Math.max(12, h.length + 4))));
  fd.views = [{ state: 'frozen', ySplit: 1 }];
  if (n) fd.autoFilter = { from: { row: 1, column: 1 }, to: { row: n + 1, column: allHeaders.length } };

  // Grid of the exported Full Data (+ Summary values as they are written) for formula verification.
  const summaryValues = new Map<string, Scalar>();
  const grid: Grid = {
    get(sheet, row, col) {
      if (sheet === D) {
        if (row === 1) return allHeaders[col - 1] ?? null;
        const v = input.rows[row - 2]?.[col - 1];
        if (v === undefined || v === null) return null;
        if (v instanceof Date) return toSerial(v.getTime());
        return v;
      }
      return summaryValues.get(`${col}:${row}`) ?? null;
    },
  };
  const fallbacks: string[] = [];
  const col = (key: string) => {
    const i = input.columns.findIndex((c) => c.key === key);
    return i < 0 ? null : colLetter(i + 1);
  };
  const rng = (key: string) => {
    const c = col(key);
    return c ? `'${D}'!$${c}$2:$${c}$${Math.max(2, n + 1)}` : null;
  };
  /** Writes a formula if it reproduces `value`, otherwise the value. */
  const put = (addr: string, formula: string | null, value: number | null, numFmt = '0', label = addr) => {
    const cell = ws.getCell(addr);
    cell.numFmt = numFmt;
    cell.font = { size: 10 };
    const record = (v: Scalar) => summaryValues.set(`${cell.col}:${cell.row}`, v);
    if (value === null) {
      cell.value = 'N/A';
      cell.alignment = { horizontal: 'right' };
      cell.font = { size: 10, color: { argb: 'FF808080' } };
      record(null);
      return;
    }
    if (formula) {
      let got: Scalar;
      try {
        got = evaluate(formula, grid, S);
      } catch {
        got = null;
      }
      if (typeof got === 'number' && Math.abs(got - value) < 1e-9) {
        cell.value = { formula, result: value };
        record(value);
        return;
      }
      fallbacks.push(label);
    } else {
      // No formula possible (a column it needs is not in Full Data): the verified backend value is written.
      fallbacks.push(label);
    }
    cell.value = value;
    record(value);
  };
  const text = (addr: string, v: string, font: Partial<ExcelJS.Font> = { size: 10 }) => {
    const c = ws.getCell(addr);
    c.value = sanitizeCell(v) as string;
    c.font = font;
    summaryValues.set(`${c.col}:${c.row}`, v);
  };
  const header = (row: number, labels: string[]) =>
    labels.forEach((l, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = l;
      c.font = HEADER_FONT;
      c.fill = HEADER_FILL;
    });
  const section = (row: number, title: string) => text(`A${row}`, title, { bold: true, size: 12, color: { argb: NAVY } });

  // ---------------------------------------------------------------- Summary: title & report date
  text('A1', input.title, { bold: true, size: 16, color: { argb: NAVY } });
  text('A2', input.sourceLine, { size: 9, color: { argb: 'FF595959' } });
  text('A3', 'Report date (follow-ups before this are overdue):', { bold: true, size: 10 });
  const rd = ws.getCell('B3');
  const reportDateMs = isoDayToMs(input.reportDate);
  rd.value = new Date(reportDateMs);
  rd.numFmt = 'dd-mmm-yyyy';
  rd.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  rd.font = { size: 10, color: { argb: 'FF0000FF' } };
  summaryValues.set('2:3', toSerial(reportDateMs));
  text('A4', `Report generated: ${input.generatedAtLabel}`, { size: 9, color: { argb: 'FF595959' } });

  // ---------------------------------------------------------------- Key numbers (rows 7–18, as in the reference)
  const k = input.report.kpis;
  section(5, 'Key Numbers');
  header(6, ['Metric', 'Value']);
  const nameR = rng('name');
  const aftR = rng('awaitingFirstTouch');
  const attR = rng('attempts');
  const stageR = rng('leadStage');
  const callsR = rng('totalCalls');
  const todayR = rng('callsToday');
  const dispR = rng('leadDisposition');
  const fuR = rng('nextFollowUpDate');
  const qualFormula = (extra = '') =>
    stageR && input.qualifiedStageLabels.length
      ? input.qualifiedStageLabels.map((l) => (extra ? `COUNTIFS(${extra},${stageR},"${l.replace(/"/g, '""')}")` : `COUNTIF(${stageR},"${l.replace(/"/g, '""')}")`)).join('+')
      : stageR
        ? extra
          ? `COUNTIFS(${extra},${stageR},"Qualified Lead")`
          : `COUNTIF(${stageR},"Qualified Lead")`
        : null;
  const kpiRows: [string, string | null, number | null, string][] = [
    ['Total leads', nameR ? `COUNTA(${nameR})` : null, k.totalLeads, '0'],
    ['Leads not yet worked (NOT_WORKED)', aftR ? `COUNTIF(${aftR},"NOT_WORKED")` : null, k.notWorked, '0'],
    ['Leads worked at least once', attR ? `COUNT(${attR})` : null, k.workedAtLeastOnce, '0'],
    ['Qualified leads', qualFormula(), k.qualified, '0'],
    ['Qualification rate', 'B10/B7', k.qualificationRate === null ? null : k.qualified! / (k.totalLeads || 1), '0.0%'],
    ['Total attempts', attR ? `SUM(${attR})` : null, k.totalAttempts, '0'],
    ['Total calls', callsR ? `SUM(${callsR})` : null, k.totalCalls, '0'],
    ['Calls today', todayR ? `SUM(${todayR})` : null, k.callsToday, '0'],
    ['Leads marked INTERESTED', dispR ? `COUNTIF(${dispR},"INTERESTED")` : null, k.interested, '0'],
    ['Overdue follow-ups', fuR ? `COUNTIFS(${fuR},"<"&$B$3)` : null, k.overdueFollowUps, '0'],
    ['Follow-ups on/after report date', fuR ? `COUNTIFS(${fuR},">="&$B$3)` : null, k.upcomingFollowUps, '0'],
    ['Leads with no follow-up date', fuR ? 'B7-B16-B17' : null, k.noFollowUpDate, '0'],
  ];
  if (k.totalLeads === 0) kpiRows[4][2] = null;
  kpiRows.forEach(([label, f, v, fmt], i) => {
    text(`A${7 + i}`, label);
    put(`B${7 + i}`, f, v, fmt, label);
  });

  // ---------------------------------------------------------------- Owners
  let row = 21;
  const charts: ChartSpec[] = [];
  const chartAt = (spec: Omit<ChartSpec, 'anchor'>, startRow: number, rows = 15) => {
    const prevEnd = charts.length ? charts[charts.length - 1].anchor.row + charts[charts.length - 1].anchor.rows + 1 : 0;
    charts.push({ ...spec, anchor: { col: 7, row: Math.max(startRow - 1, prevEnd), cols: 9, rows } });
  };
  const ownerR = rng('assignedCounsellor');
  const owners = input.report.owners;
  if (owners.length) {
    section(row, 'Performance by Lead Owner');
    header(row + 1, ['Lead Owner', 'Leads', 'Not Worked', 'Qualified', 'Total Calls', 'Calls Today']);
    const first = row + 2;
    owners.forEach((o, i) => {
      const r = first + i;
      const blank = o.owner === '(No owner)';
      text(`A${r}`, o.owner);
      const crit = blank ? '""' : `$A${r}`;
      put(`B${r}`, ownerR ? (blank ? `COUNTBLANK(${ownerR})` : `COUNTIF(${ownerR},${crit})`) : null, o.leads, '0', `${o.owner} leads`);
      put(`C${r}`, ownerR && aftR ? `COUNTIFS(${ownerR},${crit},${aftR},"NOT_WORKED")` : null, k.notWorked === null ? null : o.notWorked, '0', `${o.owner} not worked`);
      put(`D${r}`, ownerR ? qualFormula(`${ownerR},${crit}`) : null, k.qualified === null ? null : o.qualified, '0', `${o.owner} qualified`);
      put(`E${r}`, ownerR && callsR ? `SUMIF(${ownerR},${crit},${callsR})` : null, k.totalCalls === null ? null : o.totalCalls, '0', `${o.owner} total calls`);
      put(`F${r}`, ownerR && todayR ? `SUMIF(${ownerR},${crit},${todayR})` : null, k.callsToday === null ? null : o.callsToday, '0', `${o.owner} calls today`);
    });
    const last = first + owners.length - 1;
    const tr = last + 1;
    text(`A${tr}`, 'Total', { bold: true, size: 10 });
    const totals = [owners.reduce((s, o) => s + o.leads, 0), k.notWorked === null ? null : owners.reduce((s, o) => s + o.notWorked, 0), k.qualified === null ? null : owners.reduce((s, o) => s + o.qualified, 0), k.totalCalls === null ? null : owners.reduce((s, o) => s + o.totalCalls, 0), k.callsToday === null ? null : owners.reduce((s, o) => s + o.callsToday, 0)];
    ['B', 'C', 'D', 'E', 'F'].forEach((c, i) => {
      put(`${c}${tr}`, `SUM(${c}${first}:${c}${last})`, totals[i], '0', `owner total ${c}`);
      ws.getCell(`${c}${tr}`).font = { bold: true, size: 10 };
    });
    const cats = owners.map((o) => o.owner);
    const catRef = `'${S}'!$A$${first}:$A$${last}`;
    chartAt(
      {
        type: 'col',
        title: 'Leads, Qualified & Calls by Owner',
        series: [
          { nameRef: `'${S}'!$B$${row + 1}`, name: 'Leads', catRef, categories: cats, valRef: `'${S}'!$B$${first}:$B$${last}`, values: owners.map((o) => o.leads), color: SERIES[0] },
          ...(k.qualified !== null ? [{ nameRef: `'${S}'!$D$${row + 1}`, name: 'Qualified', catRef, categories: cats, valRef: `'${S}'!$D$${first}:$D$${last}`, values: owners.map((o) => o.qualified), color: SERIES[1] }] : []),
          ...(k.totalCalls !== null ? [{ nameRef: `'${S}'!$E$${row + 1}`, name: 'Total Calls', catRef, categories: cats, valRef: `'${S}'!$E$${first}:$E$${last}`, values: owners.map((o) => o.totalCalls), color: SERIES[2] }] : []),
        ],
      },
      3,
    );
    row = tr + 3;
  }

  // ---------------------------------------------------------------- Stages
  const stages = input.report.stages;
  if (stages.length) {
    section(row, 'Leads by Stage');
    header(row + 1, ['Lead Stage', 'Leads', '% of Total']);
    const first = row + 2;
    stages.forEach((s, i) => {
      const r = first + i;
      const blank = s.stage === '(No stage)';
      text(`A${r}`, s.stage);
      put(`B${r}`, stageR ? (blank ? `COUNTBLANK(${stageR})` : `COUNTIF(${stageR},$A${r})`) : null, s.leads, '0', `stage ${s.stage}`);
      put(`C${r}`, `B${r}/$B$7`, k.totalLeads ? s.leads / k.totalLeads : null, '0.0%', `stage ${s.stage} %`);
    });
    const last = first + stages.length - 1;
    const tr = last + 1;
    text(`A${tr}`, 'Total', { bold: true, size: 10 });
    put(`B${tr}`, `SUM(B${first}:B${last})`, stages.reduce((s, x) => s + x.leads, 0), '0', 'stage total');
    put(`C${tr}`, `SUM(C${first}:C${last})`, k.totalLeads ? stages.reduce((s, x) => s + x.leads, 0) / k.totalLeads : null, '0.0%', 'stage total %');
    ws.getCell(`B${tr}`).font = ws.getCell(`C${tr}`).font = { bold: true, size: 10 };
    chartAt(
      {
        type: 'pie',
        title: 'Lead Stage Mix',
        series: [{ nameRef: `'${S}'!$B$${row + 1}`, name: 'Leads', catRef: `'${S}'!$A$${first}:$A$${last}`, categories: stages.map((s) => s.stage), valRef: `'${S}'!$B$${first}:$B$${last}`, values: stages.map((s) => s.leads), color: SERIES[0] }],
        pointColors: SERIES,
      },
      row,
    );
    row = tr + 3;
  }

  // ---------------------------------------------------------------- Follow-up analysis
  if (k.overdueFollowUps !== null) {
    section(row, 'Follow-up Analysis');
    header(row + 1, ['Follow-up status', 'Leads', '% of Total']);
    const items: [string, string, number][] = [
      ['Overdue (before report date)', 'B16', k.overdueFollowUps!],
      ['Due on or after report date', 'B17', k.upcomingFollowUps!],
      ['No follow-up date', 'B18', k.noFollowUpDate!],
    ];
    const first = row + 2;
    items.forEach(([label, ref, v], i) => {
      const r = first + i;
      text(`A${r}`, label);
      put(`B${r}`, ref, v, '0', label);
      put(`C${r}`, `B${r}/$B$7`, k.totalLeads ? v / k.totalLeads : null, '0.0%', `${label} %`);
    });
    const last = first + 2;
    chartAt(
      {
        type: 'pie',
        title: 'Follow-up Status',
        series: [{ nameRef: `'${S}'!$B$${row + 1}`, name: 'Leads', catRef: `'${S}'!$A$${first}:$A$${last}`, categories: items.map((x) => x[0]), valRef: `'${S}'!$B$${first}:$B$${last}`, values: items.map((x) => x[2]), color: SERIES[0] }],
        pointColors: ['C0504D', '4F81BD', 'A6A6A6'],
      },
      row,
    );
    row = last + 3;
  }

  // ---------------------------------------------------------------- Dispositions
  const disps = input.report.dispositions;
  if (disps.length) {
    section(row, 'Lead Disposition (latest call result)');
    header(row + 1, ['Disposition', 'Leads', '% of Total']);
    const first = row + 2;
    disps.forEach((d, i) => {
      const r = first + i;
      const blank = d.disposition === NO_DISPOSITION;
      text(`A${r}`, d.disposition);
      put(`B${r}`, dispR ? (blank ? `COUNTBLANK(${dispR})` : `COUNTIF(${dispR},$A${r})`) : null, d.leads, '0', `disposition ${d.disposition}`);
      put(`C${r}`, `B${r}/$B$7`, k.totalLeads ? d.leads / k.totalLeads : null, '0.0%', `disposition ${d.disposition} %`);
    });
    const last = first + disps.length - 1;
    const tr = last + 1;
    text(`A${tr}`, 'Total', { bold: true, size: 10 });
    put(`B${tr}`, `SUM(B${first}:B${last})`, disps.reduce((s, x) => s + x.leads, 0), '0', 'disposition total');
    put(`C${tr}`, `SUM(C${first}:C${last})`, k.totalLeads ? disps.reduce((s, x) => s + x.leads, 0) / k.totalLeads : null, '0.0%', 'disposition total %');
    ws.getCell(`B${tr}`).font = ws.getCell(`C${tr}`).font = { bold: true, size: 10 };
    const recorded = disps.filter((d) => d.disposition !== NO_DISPOSITION);
    if (recorded.length)
      chartAt(
        {
          type: 'bar',
          title: 'Recorded Dispositions',
          series: [{ nameRef: `'${S}'!$B$${row + 1}`, name: 'Leads', catRef: `'${S}'!$A$${first}:$A$${first + recorded.length - 1}`, categories: recorded.map((d) => d.disposition), valRef: `'${S}'!$B$${first}:$B$${first + recorded.length - 1}`, values: recorded.map((d) => d.leads), color: SERIES[0] }],
        },
        row,
        Math.max(15, recorded.length + 4),
      );
    row = tr + 3;
  }

  // ---------------------------------------------------------------- Last worked per day
  const lw = input.report.lastWorkedByDate;
  const lwR = rng('lastWorked');
  if (lw.length) {
    section(row, 'Leads Last Worked by Date');
    header(row + 1, ['Date', 'Leads']);
    const first = row + 2;
    lw.forEach((d, i) => {
      const r = first + i;
      if (d.date === '(No date)') {
        text(`A${r}`, d.date);
        put(`B${r}`, null, d.leads, '0', 'Leads last worked: (No date)');
        return;
      }
      const c = ws.getCell(`A${r}`);
      const ms = isoDayToMs(d.date);
      c.value = new Date(ms);
      c.numFmt = 'dd-mmm-yyyy';
      c.font = { size: 10 };
      summaryValues.set(`1:${r}`, toSerial(ms));
      put(`B${r}`, lwR ? `COUNTIFS(${lwR},">="&A${r},${lwR},"<"&(A${r}+1))` : null, d.leads, '0', `last worked ${d.date}`);
    });
    const last = first + lw.length - 1;
    const tr = last + 1;
    text(`A${tr}`, 'Total', { bold: true, size: 10 });
    put(`B${tr}`, `SUM(B${first}:B${last})`, lw.reduce((s, x) => s + x.leads, 0), '0', 'last worked total');
    ws.getCell(`B${tr}`).font = { bold: true, size: 10 };
    const dated = lw.filter((d) => d.date !== '(No date)');
    if (dated.length)
      chartAt(
        {
          type: 'col',
          title: 'Leads Last Worked per Day',
          series: [{ nameRef: `'${S}'!$B$${row + 1}`, name: 'Leads', catRef: `'${S}'!$A$${first}:$A$${first + dated.length - 1}`, categories: dated.map((d) => d.date), valRef: `'${S}'!$B$${first}:$B$${first + dated.length - 1}`, values: dated.map((d) => d.leads), color: SERIES[0] }],
        },
        row,
      );
    row = tr + 3;
  }

  // ---------------------------------------------------------------- Notes
  section(row, 'Notes');
  const notes = [
    `Full Data sheet contains ${n} lead${n === 1 ? '' : 's'} and ${input.columns.length} selected column${input.columns.length === 1 ? '' : 's'}; values are exactly as uploaded unless a column mapping or rename was approved.`,
    ...input.report.notes,
    ...(input.report.missingFields.length ? [`Not in the uploaded data (shown as N/A): ${input.report.missingFields.join(', ')}.`] : []),
    'Change the yellow Report date cell (B3) to refresh overdue follow-up counts.',
    ...(fallbacks.length ? [`${fallbacks.length} figure(s) are written as values calculated by LeadPulse because a column they need was not included in Full Data.`] : []),
  ];
  notes.forEach((t, i) => text(`A${row + 1 + i}`, `• ${t}`));
  ws.getColumn(1).width = 44;
  for (let c = 2; c <= 6; c++) ws.getColumn(c).width = 14;

  // ---------------------------------------------------------------- Extra sheets
  for (const sheet of input.extraSheets) {
    const x = wb.addWorksheet(sheet.name.slice(0, 31));
    let r = 1;
    if (sheet.note) {
      x.getCell(1, 1).value = sheet.note;
      x.getCell(1, 1).font = { italic: true, size: 9, color: { argb: 'FF595959' } };
      r = 3;
    }
    sheet.headers.forEach((h, i) => {
      const c = x.getCell(r, i + 1);
      c.value = h;
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
      x.getColumn(i + 1).width = Math.min(34, Math.max(12, h.length + 4));
    });
    sheet.rows.forEach((vals, i) =>
      vals.forEach((v, j) => {
        if (v === null || v === '') return;
        const c = x.getCell(r + 1 + i, j + 1);
        c.value = safe(v);
        if (v instanceof Date) c.numFmt = 'dd-mmm-yyyy hh:mm';
        else if (typeof v === 'string' && /^\d+$/.test(v)) c.numFmt = '@';
      }),
    );
    x.views = [{ state: 'frozen', ySplit: r }];
  }
  if (input.comparison) {
    const c = input.comparison;
    const x = wb.addWorksheet('File Comparison');
    const heads = ['File', 'Records', 'Valid leads', 'Duplicate records', 'Within-file duplicates', 'Invalid', 'Incomplete', 'Data quality %', 'Qualification rate %', 'Owners', 'Stages'];
    heads.forEach((h, i) => {
      const cell = x.getCell(1, i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
      x.getColumn(i + 1).width = i === 0 ? 34 : i >= 9 ? 44 : 14;
    });
    c.files.forEach((f, i) => {
      const vals: CellOut[] = [
        f.fileName,
        f.totalRecords,
        f.validLeads,
        f.duplicateRecords,
        f.withinFileDuplicates,
        f.invalidRecords,
        f.incompleteRecords,
        f.qualityScore,
        f.qualificationRate,
        f.owners.map((o) => `${o.label}: ${o.count}`).join('; '),
        f.stages.map((o) => `${o.label}: ${o.count}`).join('; '),
      ];
      vals.forEach((v, j) => {
        if (v !== null) x.getCell(i + 2, j + 1).value = safe(v);
      });
    });
  }
  const pd = wb.addWorksheet('Processing Details');
  pd.getColumn(1).width = 34;
  pd.getColumn(2).width = 70;
  let pr = 1;
  pd.getCell(pr, 1).value = 'Processing Details';
  pd.getCell(pr, 1).font = { bold: true, size: 14, color: { argb: NAVY } };
  pr += 2;
  for (const { label, value } of [...input.processing, { label: 'Figures written as values (not formulas)', value: fallbacks.join('; ') || 'None — all summary figures are live formulas' }]) {
    pd.getCell(pr, 1).value = label;
    pd.getCell(pr, 1).font = { bold: true };
    pd.getCell(pr, 2).value = sanitizeCell(value) as string;
    pd.getCell(pr, 2).alignment = { wrapText: true, vertical: 'top' };
    pr++;
  }
  for (const t of input.processingTables) {
    pr += 1;
    pd.getCell(pr, 1).value = t.title;
    pd.getCell(pr, 1).font = { bold: true, size: 12, color: { argb: NAVY } };
    pr++;
    t.headers.forEach((h, i) => {
      const c = pd.getCell(pr, i + 1);
      c.value = h;
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
      if (i > 1) pd.getColumn(i + 1).width = Math.max(pd.getColumn(i + 1).width ?? 12, 18);
    });
    for (const vals of t.rows) {
      pr++;
      vals.forEach((v, j) => {
        if (v !== null && v !== '') pd.getCell(pr, j + 1).value = safe(v);
      });
    }
    pr++;
  }

  const base = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const buffer = await addChartsToWorkbook(base, 1, charts);
  return { buffer, formulaFallbacks: fallbacks };
}

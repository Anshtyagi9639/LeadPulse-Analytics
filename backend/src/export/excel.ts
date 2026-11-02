import ExcelJS from 'exceljs';
import type { Report } from '../domain/kpi.js';
import type { ValidationIssue } from '../domain/validate.js';
import { sanitizeCell } from '../lib/sanitize.js';
import { buildTable, duplicateModeLabel, executiveRows, type CellKind, type Table, type TableKey } from './tables.js';

const BRAND = 'FF1E3A8A';
const HEADER_FILL = 'FFE8EEF9';

function numFmt(kind: CellKind, currency: string): string | undefined {
  switch (kind) {
    case 'int':
      return '#,##0';
    case 'num':
      return '#,##0.##';
    case 'pct':
      return '0.00"%"';
    case 'money':
      return `"${currency} "#,##0.00`;
    case 'minutes':
      return '0.0';
    default:
      return undefined;
  }
}

function writeTable(ws: ExcelJS.Worksheet, table: Table, startRow: number, currency: string, rowKinds?: CellKind[]): void {
  const header = ws.getRow(startRow);
  table.columns.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: 'FF0F172A' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
    ws.getColumn(i + 1).width = col.width ?? Math.max(12, Math.min(22, col.header.length + 4));
  });
  header.height = 30;
  table.rows.forEach((values, r) => {
    const row = ws.getRow(startRow + 1 + r);
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      const kind = rowKinds && i === 1 ? rowKinds[r] : table.columns[i]?.kind;
      if (v === null || v === undefined) {
        cell.value = i === 0 ? '' : 'N/A';
        if (i > 0) cell.font = { color: { argb: 'FF94A3B8' } };
        cell.alignment = { horizontal: 'right' };
      } else if (typeof v === 'number') {
        cell.value = v;
        const fmt = kind ? numFmt(kind, currency) : undefined;
        if (fmt) cell.numFmt = fmt;
      } else {
        cell.value = sanitizeCell(v) as string;
        if (table.columns[i]?.kind === 'text') cell.alignment = { wrapText: (table.columns[i].width ?? 0) >= 40, vertical: 'top' };
      }
    });
  });
  ws.views = [{ state: 'frozen', ySplit: startRow, xSplit: 1 }];
  if (table.rows.length) {
    ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + table.rows.length, column: table.columns.length } };
  }
}

export async function buildWorkbook(report: Report, issues: ValidationIssue[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LeadPulse Analytics';
  wb.created = new Date(report.generatedAt);

  // 1. Executive summary with a context header.
  const exec = wb.addWorksheet('Executive Summary', { properties: { tabColor: { argb: BRAND } } });
  exec.getCell('A1').value = 'Daily Lead KPI & KPM Report';
  exec.getCell('A1').font = { bold: true, size: 16, color: { argb: BRAND } };
  const period = report.period.isRange ? `${report.period.from} to ${report.period.to}` : report.period.from;
  const context: [string, string][] = [
    ['Reporting period', period],
    ['Files included', sanitizeCell(report.scope.fileNames.join(', ')) as string],
    ['Duplicate handling', duplicateModeLabel(report.settings.duplicateMode)],
    ['Date filter', report.settings.dateFilter === 'restrict' ? 'Reporting period only' : 'All rows (out-of-period rows flagged)'],
    ['Filters', [report.settings.filters.campaigns.length ? `Campaigns: ${report.settings.filters.campaigns.join(', ')}` : '', report.settings.filters.sources.length ? `Sources: ${report.settings.filters.sources.join(', ')}` : ''].filter(Boolean).join('; ') || 'None'],
    ['Generated', new Date(report.generatedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'],
  ];
  context.forEach(([k, v], i) => {
    exec.getCell(`A${i + 2}`).value = k;
    exec.getCell(`A${i + 2}`).font = { bold: true };
    exec.getCell(`B${i + 2}`).value = sanitizeCell(v) as string;
  });
  const execTable = buildTable('executive', report, issues);
  writeTable(exec, execTable, context.length + 3, report.currency, executiveRows(report).map((r) => r.kind));
  exec.views = [{ state: 'frozen', ySplit: context.length + 3 }];

  const sheets: [TableKey, string][] = [
    ['files', 'File-wise Summary'],
    ['campaigns', 'Campaign-wise Performance'],
    ['sources', 'Source-wise Performance'],
    ['counsellors', 'Counsellor Performance'],
    ['funnel', 'Lead Funnel'],
    ['data-quality', 'Data Quality'],
    ['definitions', 'KPI Definitions'],
  ];
  if (issues.length) sheets.push(['validation-errors', 'Validation Errors']);
  for (const [key, name] of sheets) {
    const ws = wb.addWorksheet(name);
    const table = buildTable(key, report, issues);
    if (key === 'counsellors' && !table.rows.length) {
      ws.getCell('A1').value = 'Counsellor data is not available: no Assigned Counsellor column is mapped.';
      continue;
    }
    writeTable(ws, table, 1, report.currency);
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
